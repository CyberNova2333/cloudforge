// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import type { DrizzleDB } from '../../db/middleware';
import { pullRequests, prReviewers } from '../../db/app.schema';
import { reviewGateFor } from '../../review/gate';
import {
  executeReviewerRetry,
  REVIEW_STALE_MS,
  stopStaleReviews,
} from '../../review/head';
import { retryReviewer } from '../../review/reviewers';
import { MergeResolutionWorkflow } from '../../merge/workflow';
import { call, settle } from '../helpers/app';
import {
  AGENT_MD,
  agentModels,
  appRepo,
  invitedAgent,
  openPull,
  reviewers,
  runReviews,
  startReview,
  step,
} from '../helpers/reviews';

afterEach(() => vi.useRealTimers());

async function nextRetrySecond(db: DrizzleDB, id: string) {
  const row = (await db
    .select()
    .from(prReviewers)
    .where(eq(prReviewers.id, id))
    .get())!;
  const next = Math.max(Date.now(), row.createdAt.getTime() + 1000);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(next);
}

it('a lost workflow create response preserves a completed reviewer outcome', async () => {
  const { t, admin, repo } = await appRepo();
  await invitedAgent(t, admin, 'secagent', AGENT_MD());
  const { head } = await openPull(t, admin, repo, { 'src/a.ts': 'a\n' });
  await startReview(t);
  await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
  const [failed] = await reviewers(t);
  expect(failed.status).toBe('failed');
  const db = drizzle(t.env.DB, { schema });
  const pr = (await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  await nextRetrySecond(db, failed.id);
  const models = agentModels({
    review: () => ({
      verdict: 'findings',
      summary: 'Review completed.',
      findings: [
        {
          kind: 'change_requested',
          title: 'Review finding',
          detail: 'Required follow-up.',
          changes: [],
          diagram: null,
          snippets: [],
          paths: ['src/a.ts'],
        },
      ],
    }),
  }).models;
  const after: Promise<unknown>[] = [];
  const retryEnv = {
    ...t.env,
    MERGE_RESOLUTION: {
      ...t.env.MERGE_RESOLUTION,
      create: async () => {
        await executeReviewerRetry(
          {
            env: t.env,
            db,
            step,
            models,
            instanceId: 'private-reaudit-completed-review',
            delegate: null,
          },
          failed.id
        );
        expect((await reviewers(t))[0].status).toBe('changes_requested');
        expect(
          (
            await call(t, '/api/repos/octocat/app/pulls/1/approval', {
              cookie: admin,
              method: 'POST',
            })
          ).status
        ).toBe(200);
        await settle(t);
        expect((await reviewGateFor(db, true, pr, head)).satisfied).toBe(false);
        throw new Error(
          'Injected lost create response after successful workflow completion'
        );
      },
    },
  } as unknown as typeof t.env;
  const result = await retryReviewer(retryEnv, db, pr, failed.id, head, (p) =>
    after.push(p)
  );
  await Promise.all(after);
  await settle(t);
  expect(result).toMatchObject({ ok: false, status: 503 });
  expect({
    status: (await reviewers(t))[0].status,
    gateSatisfied: (await reviewGateFor(db, true, pr, head)).satisfied,
  }).toEqual({ status: 'changes_requested', gateSatisfied: false });
});

it('a late retry failure and delayed workflow cannot overwrite a newer attempt', async () => {
  const { t, admin, repo } = await appRepo();
  await invitedAgent(t, admin, 'secagent', AGENT_MD());
  const { head } = await openPull(t, admin, repo, { 'src/a.ts': 'a\n' });
  await startReview(t);
  await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
  const [failed] = await reviewers(t);
  const db = drizzle(t.env.DB, { schema });
  const pr = (await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  await nextRetrySecond(db, failed.id);
  const after: Promise<unknown>[] = [];
  let olderGeneration = 0;
  const retryEnv = {
    ...t.env,
    MERGE_RESOLUTION: {
      ...t.env.MERGE_RESOLUTION,
      create: async () => {
        olderGeneration = (await db
          .select()
          .from(prReviewers)
          .where(eq(prReviewers.id, failed.id))
          .get())!.createdAt.getTime();
        await executeReviewerRetry(
          {
            env: t.env,
            db,
            step,
            models: agentModels({ failReview: ['secagent'] }).models,
          },
          failed.id,
          olderGeneration
        );
        expect((await reviewers(t))[0].status).toBe('failed');
        await nextRetrySecond(db, failed.id);
        expect(
          await retryReviewer(t.env, db, pr, failed.id, head, (p) =>
            after.push(p)
          )
        ).toEqual({ ok: true });
        throw new Error('Lost older retry response');
      },
    },
  } as unknown as typeof t.env;
  expect(
    await retryReviewer(retryEnv, db, pr, failed.id, head, (p) => after.push(p))
  ).toMatchObject({ ok: false, status: 503 });
  await Promise.all(after);
  const current = (await db
    .select()
    .from(prReviewers)
    .where(eq(prReviewers.id, failed.id))
    .get())!;
  expect(current.status).toBe('reviewing');
  expect(current.createdAt.getTime()).toBeGreaterThan(olderGeneration);
  const { models, calls } = agentModels();
  await executeReviewerRetry(
    { env: t.env, db, step, models },
    failed.id,
    olderGeneration
  );
  expect(calls.reviewed).toHaveLength(0);
  expect((await reviewers(t))[0].status).toBe('reviewing');
  const run = vi.fn(async () => {
    throw new Error('A stale payload must not call AI');
  });
  const workflow = Object.assign(
    Object.create(MergeResolutionWorkflow.prototype),
    {
      env: { ...t.env, AI: { run } },
    }
  ) as MergeResolutionWorkflow;
  for (const reviewer of [
    { id: failed.id },
    { id: failed.id, generation: olderGeneration },
  ]) {
    await workflow.run(
      {
        payload: { reviewer },
        instanceId: crypto.randomUUID(),
        timestamp: new Date(),
      } as never,
      step as never
    );
  }
  expect(run).not.toHaveBeenCalled();
  expect((await reviewers(t))[0].status).toBe('reviewing');
  await executeReviewerRetry(
    { env: t.env, db, step, models },
    failed.id,
    current.createdAt.getTime()
  );
  expect((await reviewers(t))[0].status).toBe('approved');
  await settle(t);
});

it('same-second retries return 409 without advancing the retention clock or changing the failed attempt', async () => {
  const { t, admin, repo } = await appRepo();
  await invitedAgent(t, admin, 'secagent', AGENT_MD());
  const { head } = await openPull(t, admin, repo, { 'src/a.ts': 'a\n' });
  await startReview(t);
  await runReviews(t, agentModels({ failReview: ['secagent'] }).models);
  const [failed] = await reviewers(t);
  const db = drizzle(t.env.DB, { schema });
  const pr = (await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.number, 1))
    .get())!;
  const readRow = () =>
    db.select().from(prReviewers).where(eq(prReviewers.id, failed.id)).get();
  await nextRetrySecond(db, failed.id);
  const after: Promise<unknown>[] = [];
  const create = vi.fn(async () => {
    throw new Error('Workflow create failed');
  });
  const retryEnv = {
    ...t.env,
    MERGE_RESOLUTION: { ...t.env.MERGE_RESOLUTION, create },
  } as unknown as typeof t.env;
  expect(
    await retryReviewer(retryEnv, db, pr, failed.id, head, (p) => after.push(p))
  ).toMatchObject({ ok: false, status: 503 });
  const snapshot = (await readRow())!;
  expect(snapshot.createdAt.getTime()).toBe(
    Math.floor(Date.now() / 1000) * 1000
  );
  for (let i = 0; i < 4; i++) {
    expect(
      await retryReviewer(retryEnv, db, pr, failed.id, head, (p) =>
        after.push(p)
      )
    ).toMatchObject({ ok: false, status: 409 });
  }
  const response = await call(
    t,
    `/api/repos/octocat/app/pulls/1/reviewers/${failed.id}/retry`,
    {
      cookie: admin,
      method: 'POST',
    }
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: expect.stringContaining('retry'),
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(await readRow()).toEqual(snapshot);
  vi.setSystemTime(Date.now() + 1000);
  expect(
    await retryReviewer(t.env, db, pr, failed.id, head, (p) => after.push(p))
  ).toEqual({ ok: true });
  const startedAt = Date.now();
  const current = (await readRow())!;
  expect(current.createdAt.getTime()).toBeLessThanOrEqual(startedAt);
  expect(current.createdAt.getTime()).toBe(snapshot.createdAt.getTime() + 1000);
  await Promise.all(after);
  await settle(t);
  expect(
    await stopStaleReviews(
      t.env,
      db,
      new Date(startedAt + REVIEW_STALE_MS - 1000)
    )
  ).toEqual({ reviews: 0, reviewers: 0 });
  expect((await readRow())!.status).toBe('reviewing');
  const stopped = await stopStaleReviews(
    t.env,
    db,
    new Date(startedAt + REVIEW_STALE_MS + 1000)
  );
  expect(stopped.reviews + stopped.reviewers).toBeGreaterThan(0);
  expect((await readRow())!.status).toBe('failed');
  await settle(t);
});
