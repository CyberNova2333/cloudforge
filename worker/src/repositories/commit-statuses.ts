// Commit statuses (docs/webhooks.md): checks a CI server reports on a commit. Per commit and context the latest row
// counts; they hold pull requests up like Actions runs do (review/checks.ts `statusVerdict`).
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  commitStatuses,
  commitStatusStates,
  type CommitStatus,
  type CommitStatusState,
} from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { inJsonArray } from '../shared/sql-set';

export const CONTEXT_MAX = 100;
export const DESCRIPTION_MAX = 140;
export const TARGET_URL_MAX = 500;
/** Statuses one commit may carry, all contexts together. */
export const MAX_STATUSES_PER_COMMIT = 1000;

/** Shared REST/MCP input boundary; target URLs are displayed, never fetched. */
export const statusInputSchema = z.object({
  state: z.enum(commitStatusStates),
  context: z.string().trim().min(1).max(CONTEXT_MAX).optional(),
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  target_url: z
    .string()
    .trim()
    .max(TARGET_URL_MAX)
    .refine((value) => {
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, 'An http or https URL')
    .nullable()
    .optional(),
});

export type StatusInput = {
  state: CommitStatusState;
  context?: string;
  description?: string | null;
  targetUrl?: string | null;
};

/** Records a status on `sha`; refused once the commit carries MAX_STATUSES_PER_COMMIT. */
export async function createStatus(
  db: DrizzleDB,
  repositoryId: string,
  sha: string,
  input: StatusInput,
  creatorId: string | null
): Promise<{ ok: true; status: CommitStatus } | { ok: false; error: string }> {
  const count = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(commitStatuses)
    .where(
      and(
        eq(commitStatuses.repositoryId, repositoryId),
        eq(commitStatuses.sha, sha)
      )
    )
    .get();
  if (Number(count?.n ?? 0) >= MAX_STATUSES_PER_COMMIT)
    return {
      ok: false,
      error: `A commit can have at most ${MAX_STATUSES_PER_COMMIT} statuses`,
    };
  const status: CommitStatus = {
    id: crypto.randomUUID(),
    repositoryId,
    sha,
    context: input.context?.trim() || 'default',
    state: input.state,
    targetUrl: input.targetUrl?.trim() || null,
    description: input.description?.trim() || null,
    creatorId,
    createdAt: new Date(),
  };
  await db.insert(commitStatuses).values(status);
  return { ok: true, status };
}

/** Every status of `sha`, newest first. */
export function statusesOf(db: DrizzleDB, repositoryId: string, sha: string) {
  return db
    .select()
    .from(commitStatuses)
    .where(
      and(
        eq(commitStatuses.repositoryId, repositoryId),
        eq(commitStatuses.sha, sha)
      )
    )
    .orderBy(desc(commitStatuses.createdAt), desc(sql`rowid`))
    .all();
}

/** Each commit's latest status per context (by context name). One query. */
export async function latestStatuses(
  db: DrizzleDB,
  repositoryId: string,
  shas: string[]
): Promise<Map<string, CommitStatus[]>> {
  const out = new Map<string, CommitStatus[]>(shas.map((s) => [s, []]));
  if (!shas.length) return out;
  const rows = await db
    .select()
    .from(commitStatuses)
    .where(
      and(
        eq(commitStatuses.repositoryId, repositoryId),
        inJsonArray(commitStatuses.sha, shas)
      )
    )
    // D1 timestamps have millisecond precision. rowid is insertion order,
    // so reports in one millisecond cannot leave an earlier success effective.
    .orderBy(desc(commitStatuses.createdAt), desc(sql`rowid`))
    .all();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.sha}\0${r.context}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.get(r.sha)?.push(r);
  }
  for (const list of out.values())
    list.sort((a, b) => a.context.localeCompare(b.context));
  return out;
}

/** The statuses' combined state: failure if any failed or errored, else pending if any is, else success; null for none. */
export function combinedState(
  list: Pick<CommitStatus, 'state'>[]
): 'success' | 'failure' | 'pending' | null {
  if (!list.length) return null;
  if (list.some((s) => s.state === 'failure' || s.state === 'error'))
    return 'failure';
  if (list.some((s) => s.state === 'pending')) return 'pending';
  return 'success';
}
