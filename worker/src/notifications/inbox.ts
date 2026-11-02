// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// A member's notification inbox (docs/notifications.md), for the web API and the MCP tools: only notifications in
// repositories they can still read, about issues and pull requests that still exist.
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
  issues,
  notifications,
  pullRequests,
  repositories,
  teams,
  type NotificationReason,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import type { SessionUser } from '../variables';
import { findRepo, visibleTo } from '../repositories/service';
import { inJsonArray } from '../shared/sql-set';
import { toPublicUser } from '../members/users';

export type InboxFilters = {
  filter: 'unread' | 'all';
  reason?: NotificationReason;
  /** `owner/name`. */
  repo?: string;
  limit: number;
  offset: number;
};

function inboxWhere(user: SessionUser, extra: (SQL | undefined)[] = []) {
  return and(
    eq(notifications.userId, user.id),
    visibleTo(user),
    sql`(${notifications.issueId} IS NOT NULL OR ${notifications.pullRequestId} IS NOT NULL)`,
    ...extra
  );
}

/** The filter for repository `owner/name`: undefined without one, `0` (nothing) when it names no repository. */
async function repoWhere(
  db: DrizzleDB,
  name: string | undefined
): Promise<SQL | undefined> {
  if (!name) return undefined;
  const [owner, repo] = name.split('/');
  const found = owner && repo ? await findRepo(db, owner, repo) : null;
  return found ? eq(notifications.repositoryId, found.repo.id) : sql`0`;
}

async function countWhere(db: DrizzleDB, where: SQL | undefined) {
  const row = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(notifications)
    .innerJoin(repositories, eq(repositories.id, notifications.repositoryId))
    .where(where)
    .get();
  return Number(row?.n ?? 0);
}

/** `user`'s unread notifications. */
export const unreadCount = (db: DrizzleDB, user: SessionUser) =>
  countWhere(db, inboxWhere(user, [eq(notifications.unread, true)]));

/** One page of `user`'s inbox, newest first, with the count matching the filters and the unread count. */
export async function listInbox(
  db: DrizzleDB,
  user: SessionUser,
  f: InboxFilters
) {
  const where = inboxWhere(user, [
    f.filter === 'unread' ? eq(notifications.unread, true) : undefined,
    f.reason ? eq(notifications.reason, f.reason) : undefined,
    await repoWhere(db, f.repo),
  ]);
  const actor = alias(users, 'actor');
  const owner = alias(users, 'owner');
  const [rows, total, unread] = await Promise.all([
    db
      .select({
        // Full-table projections across these joins exceed D1's result-column budget as
        // the schemas grow. Fetch only the inbox payload, not bodies or private user fields.
        n: {
          id: notifications.id,
          unread: notifications.unread,
          reason: notifications.reason,
          event: notifications.event,
          excerpt: notifications.excerpt,
          updatedAt: notifications.updatedAt,
        },
        repo: { name: repositories.name },
        owner: { id: owner.id, username: owner.username },
        team: { id: teams.id, slug: teams.slug },
        actor: {
          id: actor.id,
          username: actor.username,
          name: actor.name,
          image: actor.image,
        },
        issue: {
          id: issues.id,
          number: issues.number,
          title: issues.title,
          state: issues.state,
          stateReason: issues.stateReason,
        },
        pull: {
          id: pullRequests.id,
          number: pullRequests.number,
          title: pullRequests.title,
          state: pullRequests.state,
        },
      })
      .from(notifications)
      .innerJoin(repositories, eq(repositories.id, notifications.repositoryId))
      .innerJoin(owner, eq(owner.id, repositories.ownerId))
      .leftJoin(teams, eq(teams.id, repositories.teamId))
      .leftJoin(actor, eq(actor.id, notifications.actorId))
      .leftJoin(issues, eq(issues.id, notifications.issueId))
      .leftJoin(pullRequests, eq(pullRequests.id, notifications.pullRequestId))
      .where(where)
      .orderBy(desc(notifications.updatedAt))
      .limit(f.limit)
      .offset(f.offset)
      .all(),
    countWhere(db, where),
    unreadCount(db, user),
  ]);
  const items = rows.flatMap((r) => {
    const fullName = `${r.team?.slug ?? r.owner.username ?? r.owner.id}/${r.repo.name}`;
    const subject = r.issue
      ? {
          kind: 'issue' as const,
          number: r.issue.number,
          title: r.issue.title,
          state: r.issue.state,
          stateReason: r.issue.stateReason,
        }
      : r.pull
        ? {
            kind: 'pull' as const,
            number: r.pull.number,
            title: r.pull.title,
            state: r.pull.state,
            stateReason: null,
          }
        : null;
    if (!subject) return [];
    return [
      {
        id: r.n.id,
        unread: r.n.unread,
        reason: r.n.reason,
        event: r.n.event,
        actor: r.actor ? toPublicUser(r.actor) : null,
        excerpt: r.n.excerpt,
        repository: fullName,
        subject,
        url: `/${fullName}/${subject.kind === 'issue' ? 'issues' : 'pull'}/${subject.number}`,
        updatedAt: r.n.updatedAt.toISOString(),
      },
    ];
  });
  return { items, total, unread };
}

/** Marks `userId`'s notifications read: `ids`, or all of them (in repository `repo` when given). Returns how many. */
export async function markRead(
  db: DrizzleDB,
  userId: string,
  opts: { ids?: string[]; all?: boolean; repo?: string }
): Promise<number> {
  if (!opts.all && !opts.ids?.length) return 0;
  const changed = await db
    .update(notifications)
    .set({ unread: false })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.unread, true),
        opts.all ? undefined : inJsonArray(notifications.id, opts.ids ?? []),
        await repoWhere(db, opts.repo)
      )
    )
    .returning({ id: notifications.id });
  return changed.length;
}
