// Issues (docs/issues.md): numbered with pull requests from `repositories.next_pr_number`, so `#N` names one or the
// other. Writes here never check permissions; the router and the MCP tools do (who may do what is in the doc).
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  agents,
  issueAssignees,
  issueComments,
  issueEvents,
  issueLabels,
  issues,
  labels,
  repositories,
  repositoryCollaborators,
  type Issue,
  type IssueEventKind,
  type IssueStateReason,
  type Label,
  type Repository,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import { d1Of } from '../pulls/events';
import { notify, type NotifyCtx, type Thread } from './notifications';
import { searchTerms } from './pull-search';
import { inJsonArray } from './sql-set';
import { contains, startsWith } from './text-match';

export const ISSUE_TITLE_MAX = 256;
export const ISSUE_BODY_MAX = 65536;
export const MAX_ISSUE_LABELS = 20;
export const MAX_ISSUE_ASSIGNEES = 10;
export const MAX_REPO_LABELS = 200;
export const LABEL_NAME_MAX = 50;
export const LABEL_DESCRIPTION_MAX = 100;
export const LABEL_COLOR_RE = /^[0-9a-f]{6}$/;

export type Refused = {
  ok: false;
  status: 400 | 404 | 409 | 422;
  error: string;
};

/** An issue as a notification thread. */
export const issueThread = (
  issue: Pick<Issue, 'id' | 'repositoryId'>
): Thread => ({
  kind: 'issue',
  id: issue.id,
  repositoryId: issue.repositoryId,
});

export function getIssue(
  db: DrizzleDB,
  repositoryId: string,
  number: number
): Promise<Issue | undefined> {
  return db
    .select()
    .from(issues)
    .where(
      and(eq(issues.repositoryId, repositoryId), eq(issues.number, number))
    )
    .get();
}

/** `names` as the repository's labels, ignoring case; refused naming the first one it does not have. */
export async function labelsNamed(
  db: DrizzleDB,
  repositoryId: string,
  names: string[]
): Promise<{ ok: true; labels: Label[] } | Refused> {
  const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()))].filter(
    Boolean
  );
  if (wanted.length > MAX_ISSUE_LABELS)
    return {
      ok: false,
      status: 422,
      error: `An issue can have at most ${MAX_ISSUE_LABELS} labels`,
    };
  if (!wanted.length) return { ok: true, labels: [] };
  const found = await db
    .select()
    .from(labels)
    .where(
      and(
        eq(labels.repositoryId, repositoryId),
        inJsonArray(sql`lower(${labels.name})`, wanted)
      )
    )
    .all();
  const have = new Set(found.map((l) => l.name.toLowerCase()));
  const missing = wanted.find((n) => !have.has(n));
  if (missing)
    return {
      ok: false,
      status: 422,
      error: `There is no label "${missing}" in this repository`,
    };
  return { ok: true, labels: found };
}

/**
 * `usernames` as people who can push to `repo` (site admins, its owner or creator, collaborators); refused naming the
 * first one who cannot, or who is a reviewer agent.
 */
export async function assigneesNamed(
  db: DrizzleDB,
  repo: Repository,
  usernames: string[]
): Promise<{ ok: true; users: { id: string; username: string }[] } | Refused> {
  const wanted = [
    ...new Set(usernames.map((u) => u.trim().toLowerCase()).filter(Boolean)),
  ];
  if (wanted.length > MAX_ISSUE_ASSIGNEES)
    return {
      ok: false,
      status: 422,
      error: `An issue can have at most ${MAX_ISSUE_ASSIGNEES} assignees`,
    };
  if (!wanted.length) return { ok: true, users: [] };
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      banned: users.banned,
      agent: agents.userId,
      collaborator: repositoryCollaborators.userId,
    })
    .from(users)
    .leftJoin(agents, eq(agents.userId, users.id))
    .leftJoin(
      repositoryCollaborators,
      and(
        eq(repositoryCollaborators.userId, users.id),
        eq(repositoryCollaborators.repositoryId, repo.id)
      )
    )
    .where(inJsonArray(users.username, wanted))
    .all();
  const byName = new Map(rows.map((r) => [r.username ?? '', r]));
  for (const name of wanted) {
    const u = byName.get(name);
    const pushes =
      u &&
      !u.agent &&
      !u.banned &&
      (u.role === 'admin' || u.id === repo.ownerId || !!u.collaborator);
    if (!pushes)
      return {
        ok: false,
        status: 422,
        error: `@${name} can't be assigned: only people with push access to this repository can be`,
      };
  }
  return {
    ok: true,
    users: rows.map((r) => ({ id: r.id, username: r.username ?? r.id })),
  };
}

type EventRow = typeof issueEvents.$inferInsert;
const event = (
  issueId: string,
  kind: IssueEventKind,
  data: Record<string, unknown>,
  actorId: string | null,
  at: number
): EventRow => ({
  id: crypto.randomUUID(),
  issueId,
  kind,
  data,
  actorId,
  createdAt: new Date(at),
});

/** Opens an issue with its labels and assignees, claiming the repository's next number (shared with pull requests). */
export async function openIssue(opts: {
  db: DrizzleDB;
  repo: Repository;
  authorId: string;
  title: string;
  body: string;
  labels?: Label[];
  assigneeIds?: string[];
  /** Notifies watchers and whoever it names or assigns. */
  notify?: NotifyCtx;
}): Promise<Issue> {
  const { db, repo } = opts;
  const id = crypto.randomUUID();
  const now = new Date();
  // As openPull: the bump and the insert share a batch, and the insert reads the bumped value.
  await db.batch([
    db
      .update(repositories)
      .set({
        nextPrNumber: sql`${repositories.nextPrNumber} + 1`,
        updatedAt: now,
      })
      .where(eq(repositories.id, repo.id)),
    db.insert(issues).values({
      id,
      repositoryId: repo.id,
      number:
        sql`(SELECT next_pr_number - 1 FROM repositories WHERE id = ${repo.id})` as unknown as number,
      title: opts.title.trim(),
      body: opts.body,
      authorId: opts.authorId,
      state: 'open',
      createdAt: now,
      updatedAt: now,
    }),
    ...(opts.labels?.length
      ? [
          db
            .insert(issueLabels)
            .values(opts.labels.map((l) => ({ issueId: id, labelId: l.id }))),
        ]
      : []),
    ...(opts.assigneeIds?.length
      ? [
          db
            .insert(issueAssignees)
            .values(
              opts.assigneeIds.map((userId) => ({ issueId: id, userId }))
            ),
        ]
      : []),
  ]);
  const issue = (await db
    .select()
    .from(issues)
    .where(eq(issues.id, id))
    .get())!;
  if (opts.notify)
    await notify(opts.notify, {
      thread: issueThread(issue),
      event: 'opened',
      actorId: opts.authorId,
      text: `${issue.title}\n${issue.body}`,
      assigned: opts.assigneeIds,
      joins: 'author',
    });
  return issue;
}

/** Changes the title and description; a new title is a `renamed` event. */
export async function editIssue(
  db: DrizzleDB,
  issue: Issue,
  patch: { title?: string; body?: string },
  actorId: string
) {
  const title = patch.title?.trim();
  const renamed = title !== undefined && title !== issue.title;
  if (!renamed && (patch.body === undefined || patch.body === issue.body))
    return;
  const now = Date.now();
  await db.batch([
    db
      .update(issues)
      .set({
        ...(renamed ? { title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        updatedAt: new Date(now),
      })
      .where(eq(issues.id, issue.id)),
    ...(renamed
      ? [
          db
            .insert(issueEvents)
            .values(
              event(
                issue.id,
                'renamed',
                { from: issue.title, to: title },
                actorId,
                now
              )
            ),
        ]
      : []),
  ]);
}

/**
 * Moves `issue` between open and closed with its timeline event, in one transaction: `update` changes the row only
 * from the other state, and the event is written only when it did (`changes()`: rows the statement before changed).
 */
async function transition(
  db: DrizzleDB,
  update: D1PreparedStatement,
  row: EventRow
): Promise<boolean> {
  const d1 = d1Of(db);
  const [moved] = await d1.batch([
    update,
    d1
      .prepare(
        `INSERT INTO issue_events (id, issue_id, kind, data, actor_id, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`
      )
      .bind(
        row.id,
        row.issueId,
        row.kind,
        JSON.stringify(row.data ?? {}),
        row.actorId ?? null,
        (row.createdAt as Date).getTime()
      ),
  ]);
  return (moved.meta.changes ?? 0) > 0;
}

/**
 * Closes `issue` if it is open, as `actorId` or, with `pull`, by that pull request's landing. False when it was
 * already closed.
 */
export async function closeIssue(
  db: DrizzleDB,
  issue: Pick<Issue, 'id' | 'repositoryId'>,
  opts: {
    actorId: string | null;
    reason: IssueStateReason;
    pull?: { id: string; number: number };
    notify?: NotifyCtx;
  }
): Promise<boolean> {
  const now = Date.now();
  const at = Math.floor(now / 1000);
  const closed = await transition(
    db,
    d1Of(db)
      .prepare(
        `UPDATE issues SET state = 'closed', state_reason = ?, closed_at = ?, closed_by_id = ?, closed_by_pull_id = ?,
         updated_at = ? WHERE id = ? AND state = 'open'`
      )
      .bind(opts.reason, at, opts.actorId, opts.pull?.id ?? null, at, issue.id),
    event(
      issue.id,
      'closed',
      { reason: opts.reason, ...(opts.pull ? { pull: opts.pull.number } : {}) },
      opts.actorId,
      now
    )
  );
  if (closed && opts.notify)
    await notify(opts.notify, {
      thread: issueThread(issue),
      event: 'closed',
      actorId: opts.actorId,
    });
  return closed;
}

/** Reopens `issue` if it is closed. False when it was already open. */
export async function reopenIssue(
  db: DrizzleDB,
  issue: Pick<Issue, 'id' | 'repositoryId'>,
  actorId: string,
  notifyCtx?: NotifyCtx
): Promise<boolean> {
  const now = Date.now();
  const reopened = await transition(
    db,
    d1Of(db)
      .prepare(
        `UPDATE issues SET state = 'open', state_reason = NULL, closed_at = NULL, closed_by_id = NULL,
         closed_by_pull_id = NULL, updated_at = ? WHERE id = ? AND state = 'closed'`
      )
      .bind(Math.floor(now / 1000), issue.id),
    event(issue.id, 'reopened', {}, actorId, now)
  );
  if (reopened && notifyCtx)
    await notify(notifyCtx, {
      thread: issueThread(issue),
      event: 'reopened',
      actorId,
    });
  return reopened;
}

/** Makes `issue`'s labels exactly `next`, recording what was added and removed. */
export async function setIssueLabels(
  db: DrizzleDB,
  issue: Pick<Issue, 'id'>,
  next: Label[],
  actorId: string
) {
  const current = await db
    .select({ label: labels })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.labelId))
    .where(eq(issueLabels.issueId, issue.id))
    .all();
  const had = new Map(current.map((r) => [r.label.id, r.label]));
  const want = new Map(next.map((l) => [l.id, l]));
  const added = next.filter((l) => !had.has(l.id));
  const removed = [...had.values()].filter((l) => !want.has(l.id));
  if (!added.length && !removed.length) return;
  const now = Date.now();
  await db.batch([
    db
      .update(issues)
      .set({ updatedAt: new Date(now) })
      .where(eq(issues.id, issue.id)),
    ...(removed.length
      ? [
          db.delete(issueLabels).where(
            and(
              eq(issueLabels.issueId, issue.id),
              inArray(
                issueLabels.labelId,
                removed.map((l) => l.id)
              )
            )
          ),
        ]
      : []),
    ...(added.length
      ? [
          db
            .insert(issueLabels)
            .values(added.map((l) => ({ issueId: issue.id, labelId: l.id })))
            .onConflictDoNothing(),
        ]
      : []),
    db
      .insert(issueEvents)
      .values([
        ...added.map((l) =>
          event(
            issue.id,
            'labeled',
            { label: l.name, color: l.color },
            actorId,
            now
          )
        ),
        ...removed.map((l) =>
          event(
            issue.id,
            'unlabeled',
            { label: l.name, color: l.color },
            actorId,
            now
          )
        ),
      ]),
  ]);
}

/** Makes `issue`'s assignees exactly `next`, recording who was assigned and unassigned. */
export async function setIssueAssignees(
  db: DrizzleDB,
  issue: Pick<Issue, 'id' | 'repositoryId'>,
  next: { id: string; username: string }[],
  actorId: string,
  notifyCtx?: NotifyCtx
) {
  const current = await db
    .select({ id: users.id, username: users.username })
    .from(issueAssignees)
    .innerJoin(users, eq(users.id, issueAssignees.userId))
    .where(eq(issueAssignees.issueId, issue.id))
    .all();
  const had = new Set(current.map((u) => u.id));
  const want = new Set(next.map((u) => u.id));
  const added = next.filter((u) => !had.has(u.id));
  const removed = current.filter((u) => !want.has(u.id));
  if (!added.length && !removed.length) return;
  const now = Date.now();
  await db.batch([
    db
      .update(issues)
      .set({ updatedAt: new Date(now) })
      .where(eq(issues.id, issue.id)),
    ...(removed.length
      ? [
          db.delete(issueAssignees).where(
            and(
              eq(issueAssignees.issueId, issue.id),
              inArray(
                issueAssignees.userId,
                removed.map((u) => u.id)
              )
            )
          ),
        ]
      : []),
    ...(added.length
      ? [
          db
            .insert(issueAssignees)
            .values(added.map((u) => ({ issueId: issue.id, userId: u.id })))
            .onConflictDoNothing(),
        ]
      : []),
    db
      .insert(issueEvents)
      .values([
        ...added.map((u) =>
          event(issue.id, 'assigned', { user: u.id }, actorId, now)
        ),
        ...removed.map((u) =>
          event(issue.id, 'unassigned', { user: u.id }, actorId, now)
        ),
      ]),
  ]);
  if (added.length && notifyCtx)
    await notify(notifyCtx, {
      thread: issueThread(issue),
      event: 'assigned',
      actorId,
      assigned: added.map((u) => u.id),
    });
}

export async function addIssueComment(
  db: DrizzleDB,
  issue: Pick<Issue, 'id' | 'repositoryId'>,
  authorId: string,
  body: string,
  notifyCtx?: NotifyCtx
) {
  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    issueId: issue.id,
    authorId,
    body,
    createdAt: now,
    updatedAt: now,
  };
  await db.batch([
    db.insert(issueComments).values(row),
    db.update(issues).set({ updatedAt: now }).where(eq(issues.id, issue.id)),
  ]);
  if (notifyCtx)
    await notify(notifyCtx, {
      thread: issueThread(issue),
      event: 'commented',
      actorId: authorId,
      text: body,
      joins: 'participating',
    });
  return row;
}

/** Each issue's labels, oldest label first. */
export async function labelsOf(
  db: DrizzleDB,
  issueIds: string[]
): Promise<Map<string, Label[]>> {
  const out = new Map<string, Label[]>(issueIds.map((id) => [id, []]));
  if (!issueIds.length) return out;
  const rows = await db
    .select({ issueId: issueLabels.issueId, label: labels })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.labelId))
    .where(inJsonArray(issueLabels.issueId, issueIds))
    .orderBy(asc(labels.name))
    .all();
  for (const r of rows) out.get(r.issueId)?.push(r.label);
  return out;
}

/** Each issue's assignees' user ids. */
export async function assigneesOf(
  db: DrizzleDB,
  issueIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(issueIds.map((id) => [id, []]));
  if (!issueIds.length) return out;
  const rows = await db
    .select()
    .from(issueAssignees)
    .where(inJsonArray(issueAssignees.issueId, issueIds))
    .all();
  for (const r of rows) out.get(r.issueId)?.push(r.userId);
  return out;
}

/** The WHERE clause of an issue search: a number (`#12`, or digits that start one), or part of the title or author. */
export function issueSearch(q: string): SQL | undefined {
  const { words } = searchTerms(q);
  const parts: SQL[] = words.map((w) => {
    if (/^#\d+$/.test(w)) return sql`${issues.number} = ${Number(w.slice(1))}`;
    const any: SQL[] = [
      contains(issues.title, w),
      sql`${issues.authorId} IN (SELECT ${users.id} FROM ${users} WHERE ${or(contains(users.username, w), contains(users.name, w))})`,
    ];
    if (/^\d+$/.test(w))
      any.push(startsWith(sql`CAST(${issues.number} AS TEXT)`, w));
    return or(...any)!;
  });
  return parts.length ? and(...parts) : undefined;
}

export type IssueFilters = {
  state: 'open' | 'closed' | 'all';
  q?: string;
  /** A label's name, ignoring case. */
  label?: string;
  /** A user id, or `none` for unassigned issues. */
  assignee?: string;
  authorId?: string;
  limit: number;
  offset: number;
};

/** One page of a repository's issues, newest number first, with each one's comment count, and the counts. */
export async function listIssues(
  db: DrizzleDB,
  repositoryId: string,
  f: IssueFilters
) {
  const filtered = and(
    eq(issues.repositoryId, repositoryId),
    f.state === 'all' ? undefined : eq(issues.state, f.state),
    f.q ? issueSearch(f.q) : undefined,
    f.label
      ? sql`${issues.id} IN (SELECT ${issueLabels.issueId} FROM ${issueLabels} INNER JOIN ${labels} ON ${labels.id} = ${issueLabels.labelId} WHERE ${labels.repositoryId} = ${repositoryId} AND lower(${labels.name}) = ${f.label.trim().toLowerCase()})`
      : undefined,
    f.assignee === 'none'
      ? sql`NOT EXISTS (SELECT 1 FROM ${issueAssignees} WHERE ${issueAssignees.issueId} = ${issues.id})`
      : f.assignee
        ? sql`EXISTS (SELECT 1 FROM ${issueAssignees} WHERE ${issueAssignees.issueId} = ${issues.id} AND ${issueAssignees.userId} = ${f.assignee})`
        : undefined,
    f.authorId ? eq(issues.authorId, f.authorId) : undefined
  );
  const [rows, counts, total] = await Promise.all([
    db
      .select({
        issue: issues,
        // Spelled out: a single-table select drops the table name from columns in its fields, and a bare `id` here
        // would be the comment's.
        comments: sql<number>`(SELECT COUNT(*) FROM issue_comments c WHERE c.issue_id = issues.id)`,
      })
      .from(issues)
      .where(filtered)
      .orderBy(desc(issues.number))
      .limit(f.limit)
      .offset(f.offset)
      .all(),
    db
      .select({ state: issues.state, n: sql<number>`COUNT(*)` })
      .from(issues)
      .where(eq(issues.repositoryId, repositoryId))
      .groupBy(issues.state)
      .all(),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(issues)
      .where(filtered)
      .get(),
  ]);
  const count = (s: string) =>
    Number(counts.find((r) => r.state === s)?.n ?? 0);
  return {
    rows,
    openCount: count('open'),
    closedCount: count('closed'),
    total: Number(total?.n ?? 0),
  };
}
