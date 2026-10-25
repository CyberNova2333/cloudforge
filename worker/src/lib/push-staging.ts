// Protected pushes keep incoming objects reachable here until their ancestry has been checked.
// External pushes cannot write refs/pull/. A failed cleanup leaves no user-visible branch changed.
import { asc, eq, gt } from 'drizzle-orm';
import { instanceSettings, repositories } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { ZERO_SHA } from '../git/remote';
import type { GitService } from '../git/service';
import type { PushCommand } from '../git/push-protection';
import { gitFor } from './repos';

export const PUSH_STAGING_PREFIX = 'refs/pull/_push/';
const STAGED_REF = /^refs\/pull\/_push\/(\d+)-[0-9a-f-]{36}\/\d+$/;
const STAGING_RETENTION_MS = 24 * 60 * 60 * 1000;
const CURSOR_KEY = 'git.staging_cleanup_cursor';

/** CAS cleanup, in bounded batches; never remove a ref someone replaced after it was recorded. */
export async function deletePushStaging(
  git: GitService,
  staged: PushCommand[]
) {
  for (let i = 0; i < staged.length; i += 200) {
    await git.client.push(
      staged.slice(i, i + 200).map((c) => ({
        ref: c.ref,
        old: c.new,
        new: ZERO_SHA,
      })),
      []
    );
  }
}

/** Resume a bounded sweep across all repositories, including those with no closed pull requests. */
export async function prunePushStaging(
  env: CloudflareBindings,
  db: DrizzleDB,
  now = new Date(),
  limit = 50
): Promise<number> {
  const saved = await db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, CURSOR_KEY))
    .get();
  const cursor = typeof saved?.value === 'string' ? saved.value : '';
  const page = await db
    .select()
    .from(repositories)
    .where(gt(repositories.id, cursor))
    .orderBy(asc(repositories.id))
    .limit(limit)
    .all();
  let deleted = 0;
  for (const repo of page) {
    try {
      const git = gitFor(env, repo);
      const { refs } = await git.client.listRefs();
      const old = [...refs]
        .filter(([ref]) => {
          const m = STAGED_REF.exec(ref);
          return m && Number(m[1]) < now.getTime() - STAGING_RETENTION_MS;
        })
        .map(([ref, sha]) => ({ ref, old: ZERO_SHA, new: sha }));
      await deletePushStaging(git, old);
      deleted += old.length;
    } catch (error) {
      console.error('[git] could not prune staged pushes', repo.id, error);
    }
  }
  // Failed repositories are retried on the next sweep, without starving later repositories.
  const value = page.length === limit ? page.at(-1)!.id : '';
  await db
    .insert(instanceSettings)
    .values({ key: CURSOR_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: instanceSettings.key,
      set: { value, updatedAt: now },
    });
  return deleted;
}
