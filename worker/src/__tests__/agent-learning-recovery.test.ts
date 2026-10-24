// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { runActionsRetention } from '../actions/retention';
import {
  LEARN_STALE_MS,
  LEARN_STOPPED,
  recoverLessons,
} from '../learn/recover';
import { call } from './helpers/app';
import {
  closedLesson,
  fakeLearner,
  learnRuns,
  lessons,
  runLessons,
} from './helpers/lessons';

type T = Awaited<ReturnType<typeof closedLesson>>['t'];

const set = (t: T, id: string, sql: string, ...binds: unknown[]) =>
  t.env.DB.prepare(`UPDATE agent_lessons SET ${sql} WHERE id = ?`)
    .bind(...binds, id)
    .run();

const longAgo = () => Math.floor((Date.now() - LEARN_STALE_MS - 60_000) / 1000);

describe('每日学习任务恢复', () => {
  it('重新排入并启动超过过期窗口仍卡在学习中的任务；最后一次尝试后标记失败', async () => {
    const { t } = await closedLesson();
    const db = drizzle(t.env.DB, { schema });
    const [l] = await lessons(t);
    await set(
      t,
      l.id,
      `status = 'learning', run_id = 'dead', attempts = 1, started_at = ?`,
      longAgo()
    );
    const runs = learnRuns(t).length;
    expect(await recoverLessons(t.env, db)).toEqual({
      dropped: 0,
      requeued: 1,
      started: 1,
    });
    expect((await lessons(t))[0]).toMatchObject({
      status: 'pending',
      run_id: null,
      error: LEARN_STOPPED,
    });
    expect(learnRuns(t)).toHaveLength(runs + 1);

    await set(
      t,
      l.id,
      `status = 'learning', run_id = 'dead-too', attempts = 2, started_at = ?`,
      longAgo()
    );
    expect(await recoverLessons(t.env, db)).toEqual({
      dropped: 0,
      requeued: 0,
      started: 0,
    });
    expect((await lessons(t))[0]).toMatchObject({
      status: 'failed',
      run_id: null,
      retryable: 0,
      error: LEARN_STOPPED,
    });
  });

  it('不干预尚在过期窗口内的学习任务', async () => {
    const { t } = await closedLesson();
    const [l] = await lessons(t);
    await set(
      t,
      l.id,
      `status = 'learning', run_id = 'alive', attempts = 1, started_at = ?`,
      Math.floor(Date.now() / 1000) - 600
    );
    expect(await recoverLessons(t.env, drizzle(t.env.DB, { schema }))).toEqual({
      dropped: 0,
      requeued: 0,
      started: 0,
    });
    expect((await lessons(t))[0]).toMatchObject({
      status: 'learning',
      run_id: 'alive',
    });
  });

  it('仅重试可重试故障一次，不进行第二次重试，也不重试被拒绝的编辑', async () => {
    const { t } = await closedLesson();
    const db = drizzle(t.env.DB, { schema });
    const [l] = await lessons(t);
    // A rejected edit: not retryable.
    await set(t, l.id, `status = 'failed', retryable = 0, attempts = 1`);
    expect((await recoverLessons(t.env, db)).requeued).toBe(0);
    // A model failure on its first attempt: tried once more.
    await set(t, l.id, `status = 'failed', retryable = 1, attempts = 1`);
    expect(await recoverLessons(t.env, db)).toEqual({
      dropped: 0,
      requeued: 1,
      started: 1,
    });
    expect((await lessons(t))[0]).toMatchObject({
      status: 'pending',
      retryable: 0,
    });
    // It failed again: that was its last attempt.
    await set(t, l.id, `status = 'failed', retryable = 1, attempts = 2`);
    expect((await recoverLessons(t.env, db)).requeued).toBe(0);
    expect((await lessons(t))[0].status).toBe('failed');
  });

  it('启动 Workflow 丢失的待处理学习任务，且仅学习一次', async () => {
    const { t } = await closedLesson();
    expect(learnRuns(t)).toHaveLength(1);
    expect(await recoverLessons(t.env, drizzle(t.env.DB, { schema }))).toEqual({
      dropped: 0,
      requeued: 0,
      started: 1,
    });
    expect(learnRuns(t)).toHaveLength(2);
    const learner = fakeLearner();
    await runLessons(t, learner.api);
    expect(learner.starts).toHaveLength(1);
    expect((await lessons(t))[0].status).toBe('nothing');
  });

  it('丢弃已删除智能体的未完成学习任务，保留已提交的任务', async () => {
    const { t, admin } = await closedLesson();
    const db = drizzle(t.env.DB, { schema });
    const [l] = await lessons(t);
    await set(t, l.id, `status = 'committed', commit_sha = ?`, 'c'.repeat(40));
    await call(t, '/api/admin/agents/secagent', {
      cookie: admin,
      method: 'DELETE',
    });
    expect((await recoverLessons(t.env, db)).dropped).toBe(0);
    await set(t, l.id, `status = 'pending', commit_sha = NULL`);
    expect(await recoverLessons(t.env, db)).toEqual({
      dropped: 1,
      requeued: 0,
      started: 0,
    });
    expect(await lessons(t)).toEqual([]);
  });

  it('随每日保留清理运行，并报告执行结果', async () => {
    const { t } = await closedLesson();
    const status = await runActionsRetention(
      t.env,
      drizzle(t.env.DB, { schema })
    );
    expect(status).toMatchObject({
      lessonsDropped: 0,
      lessonsRequeued: 0,
      lessonsStarted: 1,
    });
  });
});
