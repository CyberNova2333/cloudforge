// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Notifications (docs/notifications.md): who hears about an event on an issue or pull request, and their inbox rows.
// One event writes every recipient's row in one statement; the email it owes is sent afterwards
// (lib/notification-email.ts). Never throws: a notification that cannot be written is logged and the change it
// reports stands.
import { and, eq } from 'drizzle-orm';
import {
  agents,
  notificationSubscriptions,
  repositories,
  repositoryCollaborators,
  repositoryWatches,
  userPreferences,
  type NotificationEvent,
  type NotificationReason,
  type Repository,
  type SubscriptionReason,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import { d1Of } from '../pulls/events';
import { publishToUsers } from '../live/publish';
import { emailConfigured } from './email';
import { deliverNotificationEmails } from './notification-email';
import { emitThreadEvent } from './webhook-events';
import { mentionedUsernames } from './mentions';
import { can, permissionsOf } from './repo-permissions';
import { inJsonArray } from './sql-set';

/** What a notification is about: an issue or a pull request of a repository. */
export type Thread = {
  kind: 'issue' | 'pull';
  id: string;
  repositoryId: string;
};

export const threadKey = (t: Pick<Thread, 'kind' | 'id'>) =>
  `${t.kind}:${t.id}`;

/** The characters of an event's text kept on the notification (and in its email). */
export const EXCERPT_MAX = 280;

/** Where notifications are written from, and how follow-up work runs (the email); absent `after`: awaited. */
export type NotifyCtx = {
  env: CloudflareBindings;
  db: DrizzleDB;
  after?: (work: Promise<unknown>) => void;
};

export type NotifyEvent = {
  thread: Thread;
  event: NotificationEvent;
  actorId: string | null;
  /** The text the event wrote (a description, a comment): its `@mentions` are named, its start is the excerpt. */
  text?: string;
  /** People this event assigns. */
  assigned?: string[];
  /** The actor joins the thread: as its author (opening it) or as a participant (commenting). */
  joins?: 'author' | 'participating';
  /** `commented`: the comment, for webhooks' `issue_comment` events. */
  commentId?: string;
};

const RANK: Record<SubscriptionReason, number> = {
  author: 5,
  assign: 4,
  mention: 3,
  participating: 2,
  manual: 1,
};
/** A subscription reason that ranks higher than the stored one replaces it (SQL, for upserts). */
const RANK_SQL = (col: string) =>
  `CASE ${col} ${Object.entries(RANK)
    .map(([r, n]) => `WHEN '${r}' THEN ${n}`)
    .join(' ')} ELSE 0 END`;

const PARTICIPATING: ReadonlySet<NotificationReason> = new Set([
  'mention',
  'assign',
  'author',
  'participating',
]);

export const EMAIL_CHOICES = ['participating', 'all', 'off'] as const;
export type EmailChoice = (typeof EMAIL_CHOICES)[number];

type Candidate = {
  id: string;
  read: boolean;
  email: boolean;
};

/**
 * `ids` as the people among them who can read `repo` (permissionsFor's rule; never an agent or a banned account),
 * with whether their account email is verified. One query.
 */
export async function readersAmong(
  db: DrizzleDB,
  repo: Repository,
  ids: string[]
): Promise<Map<string, Candidate>> {
  const out = new Map<string, Candidate>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      banned: users.banned,
      verified: users.emailVerified,
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
    .where(inJsonArray(users.id, ids))
    .all();
  for (const r of rows)
    out.set(r.id, {
      id: r.id,
      read:
        !r.banned &&
        !r.agent &&
        can(permissionsOf(repo, r, !!r.collaborator), 'read'),
      email: !!r.verified,
    });
  return out;
}

/** Each person's email choice (Settings → Notifications); no row: participating. */
async function emailChoices(
  db: DrizzleDB,
  ids: string[]
): Promise<Map<string, EmailChoice>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ userId: userPreferences.userId, value: userPreferences.value })
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.key, 'notificationEmail'),
        inJsonArray(userPreferences.userId, ids)
      )
    )
    .all();
  return new Map(
    rows.flatMap((r) =>
      (EMAIL_CHOICES as readonly unknown[]).includes(r.value)
        ? [[r.userId, r.value as EmailChoice]]
        : []
    )
  );
}

/** The excerpt kept for `text`: its start, on one line. */
export function excerptOf(text: string | undefined): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return Array.from(flat).length > EXCERPT_MAX
    ? `${Array.from(flat)
        .slice(0, EXCERPT_MAX - 1)
        .join('')
        .trimEnd()}…`
    : flat;
}

/** Subscribes `people` to `thread` (each with a reason; a stronger stored reason stays). One statement. */
async function subscribe(
  db: DrizzleDB,
  thread: Thread,
  people: { userId: string; reason: SubscriptionReason }[],
  now: number
) {
  if (!people.length) return;
  await d1Of(db)
    .prepare(
      `INSERT INTO notification_subscriptions (user_id, thread, repository_id, issue_id, pull_request_id, subscribed, reason, created_at)
       SELECT json_extract(value, '$.u'), ?, ?, ?, ?, 1, json_extract(value, '$.r'), ? FROM json_each(?) WHERE 1
       ON CONFLICT (user_id, thread) DO UPDATE SET subscribed = 1,
         reason = CASE WHEN ${RANK_SQL('excluded.reason')} > ${RANK_SQL('notification_subscriptions.reason')}
           THEN excluded.reason ELSE notification_subscriptions.reason END`
    )
    .bind(
      threadKey(thread),
      thread.repositoryId,
      thread.kind === 'issue' ? thread.id : null,
      thread.kind === 'pull' ? thread.id : null,
      now,
      JSON.stringify(people.map((p) => ({ u: p.userId, r: p.reason })))
    )
    .run();
}

/**
 * Fans an issue or pull request event out, to people and to systems. People: subscribes whoever it makes a
 * participant, then brings the thread back to unread in the inbox of everyone who follows it, watches its repository
 * or is named in it (never the actor, nor anyone who cannot read the repository), and owes an email to those who want
 * one. Systems: the repository's webhooks that take the event (lib/webhook-events.ts). Returns the people it notified.
 */
export async function notify(
  ctx: NotifyCtx,
  e: NotifyEvent
): Promise<string[]> {
  let people: string[] = [];
  try {
    people = await deliver(ctx, e);
  } catch (err) {
    console.error(
      '[notify] could not record notifications',
      e.event,
      threadKey(e.thread),
      err
    );
  }
  await emitThreadEvent(ctx, e);
  return people;
}

async function deliver(ctx: NotifyCtx, e: NotifyEvent): Promise<string[]> {
  const { db, env } = ctx;
  const repo = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, e.thread.repositoryId))
    .get();
  if (!repo) return [];
  const key = threadKey(e.thread);
  const now = Date.now();

  const usernames = e.text ? mentionedUsernames(e.text) : [];
  const mentioned = usernames.length
    ? (
        await db
          .select({ id: users.id })
          .from(users)
          .where(inJsonArray(users.username, usernames))
          .all()
      ).map((u) => u.id)
    : [];
  const assigned = e.assigned ?? [];
  const [subs, watches] = await Promise.all([
    db
      .select()
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.thread, key))
      .all(),
    db
      .select()
      .from(repositoryWatches)
      .where(eq(repositoryWatches.repositoryId, repo.id))
      .all(),
  ]);

  // Everyone who may hear about it, with the strongest reason.
  const reasons = new Map<string, NotificationReason>();
  const offer = (id: string, reason: NotificationReason) => {
    const had = reasons.get(id);
    const order = ['mention', 'assign', 'author', 'participating', 'watching'];
    if (!had || order.indexOf(reason) < order.indexOf(had))
      reasons.set(id, reason);
  };
  const unsubscribed = new Set<string>();
  for (const s of subs) {
    if (!s.subscribed) unsubscribed.add(s.userId);
    else
      offer(
        s.userId,
        s.reason === 'author'
          ? 'author'
          : s.reason === 'assign'
            ? 'assign'
            : 'participating'
      );
  }
  const ignoring = new Set<string>();
  for (const w of watches)
    if (w.level === 'ignoring') ignoring.add(w.userId);
    else if (!unsubscribed.has(w.userId)) offer(w.userId, 'watching');
  const named = new Set([...mentioned, ...assigned]);
  for (const id of mentioned) offer(id, 'mention');
  for (const id of assigned) offer(id, 'assign');
  for (const id of unsubscribed) if (!named.has(id)) reasons.delete(id);
  for (const id of ignoring) reasons.delete(id);
  if (e.actorId) reasons.delete(e.actorId);

  const people = await readersAmong(db, repo, [
    ...new Set([...reasons.keys(), ...named]),
  ]);
  const canRead = (id: string) => !!people.get(id)?.read;

  // Participants follow the thread from now on: the actor, and whoever it names who can read it.
  const joining: { userId: string; reason: SubscriptionReason }[] = [];
  if (e.actorId && e.joins)
    joining.push({ userId: e.actorId, reason: e.joins });
  for (const id of mentioned)
    if (canRead(id) && id !== e.actorId)
      joining.push({ userId: id, reason: 'mention' });
  for (const id of assigned)
    if (canRead(id)) joining.push({ userId: id, reason: 'assign' });
  await subscribe(db, e.thread, joining, now);

  const recipients = [...reasons].filter(([id]) => canRead(id));
  if (!recipients.length) return [];
  const mail = emailConfigured(env)
    ? await emailChoices(
        db,
        recipients.map(([id]) => id)
      )
    : null;
  const owesEmail = (id: string, reason: NotificationReason) => {
    if (!mail || !people.get(id)?.email) return false;
    const choice = mail.get(id) ?? 'participating';
    return (
      choice === 'all' ||
      (choice === 'participating' && PARTICIPATING.has(reason))
    );
  };
  const rows = recipients.map(([id, reason]) => ({
    u: id,
    r: reason,
    m: owesEmail(id, reason) ? now : null,
  }));
  await d1Of(db)
    .prepare(
      `INSERT INTO notifications (id, user_id, repository_id, thread, issue_id, pull_request_id, reason, event, actor_id,
         excerpt, unread, email_pending_at, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), json_extract(value, '$.u'), ?, ?, ?, ?, json_extract(value, '$.r'), ?, ?, ?, 1,
         json_extract(value, '$.m'), ?, ? FROM json_each(?) WHERE 1
       ON CONFLICT (user_id, thread) DO UPDATE SET reason = excluded.reason, event = excluded.event,
         actor_id = excluded.actor_id, excerpt = excluded.excerpt, unread = 1, updated_at = excluded.updated_at,
         email_pending_at = COALESCE(excluded.email_pending_at, notifications.email_pending_at)`
    )
    .bind(
      repo.id,
      key,
      e.thread.kind === 'issue' ? e.thread.id : null,
      e.thread.kind === 'pull' ? e.thread.id : null,
      e.event,
      e.actorId,
      excerptOf(e.text),
      now,
      now,
      JSON.stringify(rows)
    )
    .run();
  const ids = recipients.map(([id]) => id);
  await publishToUsers(env, ids);
  if (rows.some((r) => r.m !== null)) {
    const work = deliverNotificationEmails(env, db).catch((err: unknown) =>
      console.error('[notify] email delivery failed', err)
    );
    if (ctx.after) ctx.after(work);
    else await work;
  }
  return ids;
}

/** The thread's subscription state for `userId`: subscribed or not, and whether by participating or by watching. */
export async function subscriptionOf(
  db: DrizzleDB,
  userId: string,
  thread: Thread
): Promise<{
  subscribed: boolean;
  reason: SubscriptionReason | 'watching' | null;
}> {
  const [sub, watch] = await Promise.all([
    db
      .select()
      .from(notificationSubscriptions)
      .where(
        and(
          eq(notificationSubscriptions.userId, userId),
          eq(notificationSubscriptions.thread, threadKey(thread))
        )
      )
      .get(),
    db
      .select({ level: repositoryWatches.level })
      .from(repositoryWatches)
      .where(
        and(
          eq(repositoryWatches.userId, userId),
          eq(repositoryWatches.repositoryId, thread.repositoryId)
        )
      )
      .get(),
  ]);
  if (sub)
    return {
      subscribed: sub.subscribed,
      reason: sub.subscribed ? sub.reason : null,
    };
  if (watch?.level === 'watching')
    return { subscribed: true, reason: 'watching' };
  return { subscribed: false, reason: null };
}

/** Subscribes `userId` to `thread` by hand, or unsubscribes them (kept as a row, so watching does not bring it back). */
export async function setSubscription(
  db: DrizzleDB,
  userId: string,
  thread: Thread,
  subscribed: boolean
) {
  const now = new Date();
  await db
    .insert(notificationSubscriptions)
    .values({
      userId,
      thread: threadKey(thread),
      repositoryId: thread.repositoryId,
      issueId: thread.kind === 'issue' ? thread.id : null,
      pullRequestId: thread.kind === 'pull' ? thread.id : null,
      subscribed,
      reason: 'manual',
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        notificationSubscriptions.userId,
        notificationSubscriptions.thread,
      ],
      set: { subscribed },
    });
}

export const WATCH_LEVELS = ['participating', 'watching', 'ignoring'] as const;
export type WatchLevel = (typeof WATCH_LEVELS)[number];

export async function watchLevel(
  db: DrizzleDB,
  userId: string,
  repositoryId: string
): Promise<WatchLevel> {
  const row = await db
    .select({ level: repositoryWatches.level })
    .from(repositoryWatches)
    .where(
      and(
        eq(repositoryWatches.userId, userId),
        eq(repositoryWatches.repositoryId, repositoryId)
      )
    )
    .get();
  return row?.level ?? 'participating';
}

export async function setWatchLevel(
  db: DrizzleDB,
  userId: string,
  repositoryId: string,
  level: WatchLevel
) {
  const where = and(
    eq(repositoryWatches.userId, userId),
    eq(repositoryWatches.repositoryId, repositoryId)
  );
  if (level === 'participating') {
    await db.delete(repositoryWatches).where(where);
    return;
  }
  await db
    .insert(repositoryWatches)
    .values({ userId, repositoryId, level, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [repositoryWatches.userId, repositoryWatches.repositoryId],
      set: { level },
    });
}

/** How many people watch `repositoryId`. */
export async function watcherCount(db: DrizzleDB, repositoryId: string) {
  const rows = await db
    .select({ userId: repositoryWatches.userId })
    .from(repositoryWatches)
    .where(
      and(
        eq(repositoryWatches.repositoryId, repositoryId),
        eq(repositoryWatches.level, 'watching')
      )
    )
    .all();
  return rows.length;
}
