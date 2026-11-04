// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  pullRequests,
  repositories,
  landingIntents,
} from '../../db/app.schema';
import { landPull } from '../../merge/land';
import { gitFor } from '../../repositories/service';
import { createStatus } from '../../repositories/commit-statuses';
import { withdrawApproval } from '../../review/approvals';
import { checksAt, reviewGateFor } from '../../review/gate';
import { call, settle } from '../helpers/app';
import { crewRepo } from '../helpers/crew';
afterEach(() => vi.restoreAllMocks());
it.each([
  'unchanged',
  'withdrawn',
  'failed-check',
  'paused',
  'reopened',
] as const)(
  'landing honors the current gate after receipt preparation (%s)',
  async (mode) => {
    const s = await crewRepo({ actions: true });
    const head = await s.branch('feature');
    await s.web('feature');
    expect(
      (
        await call(s.t, '/api/repos/octocat/app/pulls/1/approval', {
          cookie: s.admin,
          method: 'POST',
        })
      ).status
    ).toBe(200);
    await settle(s.t);
    const pr = (await s.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.number, 1))
      .get())!;
    const repo = (await s.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, s.repoId))
      .get())!;
    const actor = (await s.t.env.DB.prepare(
      "SELECT id FROM users WHERE username = 'octocat'"
    ).first<{ id: string }>())!;
    const git = gitFor(s.t.env, repo);
    const originalPush = git.client.push.bind(git.client);
    let changed = false;
    const after: Promise<unknown>[] = [];
    vi.spyOn(git.client, 'push').mockImplementation(async (...args) => {
      const result = await originalPush(...args);
      if (!changed && args[0].some((c) => c.ref.includes('/landings/'))) {
        changed = true;
        if (mode === 'paused') {
          await s.db
            .update(repositories)
            .set({ mergingPausedAt: new Date() })
            .where(eq(repositories.id, repo.id));
        } else if (mode === 'reopened') {
          await s.db
            .update(pullRequests)
            .set({ stateRevision: pr.stateRevision + 2 })
            .where(eq(pullRequests.id, pr.id));
        } else if (mode === 'withdrawn') {
          expect(
            (
              await withdrawApproval(s.t.env, s.db, git, pr, actor.id, (p) =>
                after.push(p)
              )
            ).ok
          ).toBe(true);
          expect((await reviewGateFor(s.db, true, pr, head)).satisfied).toBe(
            false
          );
        } else if (mode === 'failed-check') {
          expect(
            (
              await createStatus(
                s.db,
                repo.id,
                head,
                { state: 'failure', context: 'audit-check' },
                actor.id
              )
            ).ok
          ).toBe(true);
          expect(await checksAt(s.db, repo.id, head)).not.toBeNull();
        }
      }
      return result;
    });
    const result = await landPull({
      env: s.t.env,
      db: s.db,
      repo,
      repoFullName: 'octocat/app',
      git,
      pr,
      by: null,
      after: (p) => after.push(p),
    });
    await Promise.all(after);
    await settle(s.t);
    expect(changed).toBe(true);
    if (mode === 'unchanged') {
      expect(result.ok).toBe(true);
      expect(s.repo.refs.get('refs/heads/main')).toBe(head);
    } else {
      expect({
        accepted: result.ok,
        targetMoved: s.repo.refs.get('refs/heads/main') !== s.main,
      }).toEqual({ accepted: false, targetMoved: false });
      const intent = await s.db
        .select()
        .from(landingIntents)
        .where(eq(landingIntents.pullRequestId, pr.id))
        .get();
      expect(intent?.finishedAt).not.toBeNull();
      expect(intent?.recordedAt).toBeNull();
    }
  }
);
