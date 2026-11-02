// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { can } from '../repositories/permissions';
// The emails notifications owe (docs/notifications.md): a row's `email_pending_at` is cleared before its email goes
// out, so a retry never sends it twice (a send that fails after that is lost, never duplicated). Rows waiting longer
// than a day are dropped rather than sent late.
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
  agents,
  issues,
  notificationSubscriptions,
  notifications,
  pullRequests,
  repositoryWatches,
  userPreferences,
  type NotificationEvent,
  type NotificationReason,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import { d1Of } from '../pulls/events';
import { emailConfigured, sendNotificationEmail } from './email';
import { findReposByIds, permissionsFor } from '../repositories/service';
import { inJsonArray } from '../shared/sql-set';

const DAY_MS = 86_400_000;
const BATCH = 50;

const WHY: Record<NotificationReason, string> = {
  mention: 'You are receiving this because you were mentioned.',
  assign: 'You are receiving this because you were assigned.',
  author: 'You are receiving this because you opened it.',
  participating: 'You are receiving this because you are subscribed to it.',
  watching: 'You are receiving this because you are watching the repository.',
};

function headline(
  actor: string,
  event: NotificationEvent,
  kind: 'issue' | 'pull',
  reason: NotificationReason
) {
  const noun = kind === 'issue' ? 'issue' : 'pull request';
  switch (event) {
    case 'opened':
      return `${actor} opened this ${noun}`;
    case 'commented':
      return `${actor} commented`;
    case 'closed':
      return `${actor} closed this ${noun}`;
    case 'reopened':
      return `${actor} reopened this ${noun}`;
    case 'merged':
      return `${actor} merged this pull request`;
    case 'assigned':
      return reason === 'assign'
        ? `${actor} assigned this ${noun} to you`
        : `${actor} changed who is assigned`;
  }
}

/** Sends up to `limit` owed emails; returns how many went out. */
export async function deliverNotificationEmails(
  env: CloudflareBindings,
  db: DrizzleDB,
  opts: { now?: number; limit?: number } = {}
): Promise<number> {
  if (!emailConfigured(env)) return 0;
  const now = opts.now ?? Date.now();
  const d1 = d1Of(db);
  await d1
    .prepare(
      'UPDATE notifications SET email_pending_at = NULL WHERE email_pending_at IS NOT NULL AND email_pending_at < ?'
    )
    .bind(now - DAY_MS)
    .run();
  const claimed = await d1
    .prepare(
      `UPDATE notifications SET email_pending_at = NULL WHERE id IN (
         SELECT id FROM notifications WHERE email_pending_at IS NOT NULL ORDER BY email_pending_at LIMIT ?)
       RETURNING id`
    )
    .bind(opts.limit ?? BATCH)
    .all<{ id: string }>();
  const ids = claimed.results.map((r) => r.id);
  if (!ids.length) return 0;
  const actor = alias(users, 'actor');
  const rows = await db
    .select({
      n: notifications,
      recipient: users,
      agent: agents.userId,
      emailChoice: userPreferences.value,
      watch: repositoryWatches.level,
      subscribed: notificationSubscriptions.subscribed,
      actor: actor.username,
      issueNumber: issues.number,
      issueTitle: issues.title,
      pullNumber: pullRequests.number,
      pullTitle: pullRequests.title,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .leftJoin(agents, eq(agents.userId, users.id))
    .leftJoin(
      userPreferences,
      and(
        eq(userPreferences.userId, users.id),
        eq(userPreferences.key, 'notificationEmail')
      )
    )
    .leftJoin(
      repositoryWatches,
      and(
        eq(repositoryWatches.userId, users.id),
        eq(repositoryWatches.repositoryId, notifications.repositoryId)
      )
    )
    .leftJoin(
      notificationSubscriptions,
      and(
        eq(notificationSubscriptions.userId, users.id),
        eq(notificationSubscriptions.thread, notifications.thread)
      )
    )
    .leftJoin(actor, eq(actor.id, notifications.actorId))
    .leftJoin(issues, eq(issues.id, notifications.issueId))
    .leftJoin(pullRequests, eq(pullRequests.id, notifications.pullRequestId))
    .where(inJsonArray(notifications.id, ids))
    .all();
  const repos = await findReposByIds(
    db,
    rows.map((r) => r.n.repositoryId)
  );
  const base = (env.BASE_URL ?? '').replace(/\/+$/, '');
  let sent = 0;
  for (const r of rows) {
    const found = repos.get(r.n.repositoryId);
    const kind = r.n.issueId ? 'issue' : 'pull';
    const number = kind === 'issue' ? r.issueNumber : r.pullNumber;
    const title = kind === 'issue' ? r.issueTitle : r.pullTitle;
    if (
      !found ||
      number === null ||
      !title ||
      !r.recipient.email ||
      !r.recipient.emailVerified
    )
      continue;
    // Outbox delivery can happen long after the event. Recheck current access and
    // choices before sending the latest title or the stored private excerpt.
    if (
      r.agent ||
      r.recipient.banned ||
      !can(await permissionsFor(db, found.repo, r.recipient), 'read') ||
      r.emailChoice === 'off' ||
      (r.emailChoice !== 'all' && r.n.reason === 'watching') ||
      r.watch === 'ignoring' ||
      r.subscribed === false ||
      (r.n.reason === 'watching' && r.watch !== 'watching')
    )
      continue;
    const fullName = `${found.namespace.username}/${found.repo.name}`;
    const ok = await sendNotificationEmail(env, db, {
      to: r.recipient.email,
      subject: `[${fullName}] ${title} (#${number})`,
      headline: headline(r.actor ?? 'CloudForge', r.n.event, kind, r.n.reason),
      excerpt: r.n.excerpt,
      url: `${base}/${fullName}/${kind === 'issue' ? 'issues' : 'pull'}/${number}`,
      why: WHY[r.n.reason],
      settingsUrl: `${base}/settings/notifications`,
    });
    if (ok) sent++;
  }
  return sent;
}

/** Daily: the inbox forgets read notifications after 90 days and every notification after a year. */
export async function pruneNotifications(db: DrizzleDB, now = Date.now()) {
  await db
    .delete(notifications)
    .where(
      sql`(${notifications.unread} = 0 AND ${notifications.updatedAt} < ${now - 90 * DAY_MS}) OR ${notifications.updatedAt} < ${now - 365 * DAY_MS}`
    );
}
