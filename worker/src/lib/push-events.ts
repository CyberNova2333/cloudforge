// A push's follow-ups, made durable. The git endpoint records the ref updates a push made (`push_events`) before it
// answers, then runs these follow-ups in the background: Cloudflare stops that 30 s after the response, so an event
// left unfinished runs again, from the next push to its repository or from the daily retention. Every follow-up may
// run twice: Actions runs are unique per event (their trigger key carries its id), the rest converge.
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { refreshAgentConfig } from '../agents/refresh';
import {
  actionsConfigured,
  onRefsUpdated,
  type RefUpdate,
} from '../actions/trigger';
import { pushEvents, repositories } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { schema } from '../db/schema';
import { ZERO_SHA } from '../git/remote';
import { publishChange } from '../live/publish';
import { startSweep } from '../merge/auto';
import { resolutionConfigured } from '../merge/resolution';
import { settleStates } from '../pulls/settle';
import { carryApprovalsOnSameTree } from '../review/carry';
import { findRepoById, gitFor } from './repos';

export type PushedRef = { old: string; new: string; ref: string };
export type PushEvent = typeof pushEvents.$inferSelect;

/** How long a run holds its event: a push's background ends 30 s after its response. */
export const PUSH_EVENT_LEASE_MS = 2 * 60_000;
/** Runs of one event before it is left alone (each failure is logged). */
export const MAX_PUSH_EVENT_ATTEMPTS = 5;
/** Unfinished events one recovery runs. */
const RECOVER_LIMIT = 20;
/** Finished (or abandoned) events are kept this long. */
const KEEP_MS = 7 * 86_400_000;

/** Records a push's ref updates that took effect; its id is the event's identity. */
export async function recordPush(
  db: DrizzleDB,
  repositoryId: string,
  actorId: string | null,
  commands: PushedRef[],
  now = new Date()
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(pushEvents)
    .values({ id, repositoryId, actorId, commands, createdAt: now });
  return id;
}

/** Takes event `id` for one run: null when it is finished, out of attempts, or another run holds it. */
async function claim(
  db: DrizzleDB,
  id: string,
  now: Date
): Promise<PushEvent | null> {
  const row = await db
    .update(pushEvents)
    .set({ attempts: sql`${pushEvents.attempts} + 1`, claimedAt: now })
    .where(
      and(
        eq(pushEvents.id, id),
        isNull(pushEvents.completedAt),
        lt(pushEvents.attempts, MAX_PUSH_EVENT_ATTEMPTS),
        or(
          isNull(pushEvents.claimedAt),
          lt(
            pushEvents.claimedAt,
            new Date(now.getTime() - PUSH_EVENT_LEASE_MS)
          )
        )
      )
    )
    .returning()
    .get();
  return row ?? null;
}

/**
 * Runs event `id`'s follow-ups, then marks it finished. Never throws: a failure leaves it unfinished (and released)
 * for a later run. True when this call finished it.
 */
export async function runPushEvent(
  env: CloudflareBindings,
  id: string,
  now = new Date()
): Promise<boolean> {
  const db = drizzle(env.DB, { schema });
  const event = await claim(db, id, now).catch((e: unknown) => {
    console.error('[git] could not claim a push event', id, e);
    return null;
  });
  if (!event) return false;
  try {
    await followUps(env, db, event);
    await db
      .update(pushEvents)
      .set({ completedAt: new Date() })
      .where(eq(pushEvents.id, id));
    return true;
  } catch (e) {
    console.error('[git] push follow-ups failed; they run again later', id, e);
    await db
      .update(pushEvents)
      .set({ claimedAt: null })
      .where(eq(pushEvents.id, id))
      .catch(() => {});
    return false;
  }
}

/**
 * Bumps `updated_at`, adopts the first pushed branch as default if missing, queues Actions runs, carries approvals,
 * starts AI resolution for newly conflicting pull requests, settles PR states and re-reads an agent's AGENT.md.
 */
async function followUps(
  env: CloudflareBindings,
  db: DrizzleDB,
  event: PushEvent
) {
  const found = await findRepoById(db, event.repositoryId);
  if (!found) return; // Deleted since: nothing to follow up.
  const { repo } = found;
  const fullName = `${found.namespace.username}/${repo.name}`;
  const patch: { updatedAt: Date; defaultBranch?: string } = {
    updatedAt: new Date(),
  };
  const git = gitFor(env, repo);
  const refsAfter = await git.refs();
  const branches = await git.branches();
  if (branches.length && !branches.some((b) => b.name === repo.defaultBranch))
    patch.defaultBranch =
      branches.find((b) => b.name === 'main')?.name ?? branches[0].name;
  await db.update(repositories).set(patch).where(eq(repositories.id, repo.id));
  if (actionsConfigured(env) || resolutionConfigured(env)) {
    // The commands that still stand: their refs are where the push put them. A ref moved again since is that
    // push's to report.
    const updates: RefUpdate[] = event.commands.filter((c) =>
      c.new === ZERO_SHA
        ? !refsAfter.has(c.ref)
        : refsAfter.get(c.ref) === c.new
    );
    await onRefsUpdated(
      env,
      db,
      repo,
      fullName,
      updates,
      event.actorId,
      event.id
    );
    // Before the sweep and the state settling below: they read approvals of the new head.
    await carryApprovalsOnSameTree(db, git, repo.id, updates).catch((e) =>
      console.error('[git] could not carry approvals', repo.id, e)
    );
    await startSweep(env, repo, updates);
  }
  await publishChange(env, repo.id, { approvals: true });
  await settleStates(env, db, repo.id);
  // An agent's repository: re-read AGENT.md if its default branch moved. Last, so it delays nothing above.
  await refreshAgentConfig(env, db, repo.id);
}

/**
 * Runs unfinished events older than their lease (oldest first; `repositoryId` limits it to one repository), then
 * deletes finished and abandoned ones past KEEP_MS. Returns the events it finished.
 */
export async function recoverPushEvents(
  env: CloudflareBindings,
  db: DrizzleDB,
  opts: { repositoryId?: string; now?: Date; limit?: number } = {}
): Promise<number> {
  const now = opts.now ?? new Date();
  const stale = new Date(now.getTime() - PUSH_EVENT_LEASE_MS);
  const pending = await db
    .select({ id: pushEvents.id })
    .from(pushEvents)
    .where(
      and(
        isNull(pushEvents.completedAt),
        lt(pushEvents.createdAt, stale),
        lt(pushEvents.attempts, MAX_PUSH_EVENT_ATTEMPTS),
        opts.repositoryId
          ? eq(pushEvents.repositoryId, opts.repositoryId)
          : undefined
      )
    )
    .orderBy(asc(pushEvents.createdAt))
    .limit(opts.limit ?? RECOVER_LIMIT)
    .all();
  let finished = 0;
  for (const { id } of pending)
    if (await runPushEvent(env, id, now)) finished++;
  if (!opts.repositoryId) {
    const old = new Date(now.getTime() - KEEP_MS);
    await db
      .delete(pushEvents)
      .where(
        and(
          lt(pushEvents.createdAt, old),
          or(
            isNotNull(pushEvents.completedAt),
            eq(pushEvents.attempts, MAX_PUSH_EVENT_ATTEMPTS)
          )
        )
      );
  }
  return finished;
}

/** A push's follow-ups in its background: its own event, then up to a few earlier ones of the repository left unfinished. */
export async function afterPush(
  env: CloudflareBindings,
  id: string,
  repositoryId: string
) {
  await runPushEvent(env, id);
  await recoverPushEvents(env, drizzle(env.DB, { schema }), {
    repositoryId,
    limit: 3,
  }).catch((e: unknown) =>
    console.error('[git] could not recover push events', repositoryId, e)
  );
}
