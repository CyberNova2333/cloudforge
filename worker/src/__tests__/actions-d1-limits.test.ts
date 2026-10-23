import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq, isNull } from 'drizzle-orm';
import { schema } from '../db/schema';
import {
  runnerSessions,
  workflowJobs,
  workflowRuns,
  workflowSteps,
} from '../db/app.schema';
import { TOOL_HANDLERS } from '../mcp/tools';
import { runnersStopped } from '../usage/record';
import { call, settle } from './helpers/app';
import { pushFiles, setup } from './helpers/actions';

async function largeRun() {
  const s = await setup();
  const matrix = Array.from({ length: 20 }, (_, i) => i).join(', ');
  const jobs = Array.from(
    { length: 6 },
    (_, i) => `  group${i}:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [${matrix}]
    steps:
      - run: echo test
`
  ).join('');
  await pushFiles(s, 'main', {
    '.github/workflows/large.yml': `name: Large\non: push\njobs:\n${jobs}`,
  });
  const db = drizzle(s.t.env.DB, { schema });
  const run = (await db.select().from(workflowRuns).get())!;
  const planned = await db
    .select()
    .from(workflowJobs)
    .where(eq(workflowJobs.runId, run.id));
  expect(planned).toHaveLength(120);
  return { ...s, db, run, planned };
}

describe('多个矩阵下的 Actions D1 限制', () => {
  it('通过运行 API 返回所有作业和步骤', async () => {
    const s = await largeRun();
    const res = await call(s.t, '/api/repos/octocat/app/actions/runs/1', {
      cookie: s.admin,
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { jobs: { steps: unknown[] }[] };
    expect(detail.jobs).toHaveLength(120);
    expect(detail.jobs.every((j) => j.steps.length === 3)).toBe(true);
  });

  it('通过 MCP 日志返回所有步骤摘要', async () => {
    const s = await largeRun();
    const user = (await s.db.query.users.findFirst())!;
    const result = await TOOL_HANDLERS.get('gitorange_get_run_logs')!.handler(
      { repository: 'octocat/app', run_number: 1 },
      {
        db: s.db,
        env: s.t.env,
        user,
        baseURL: 'http://test.local',
        after: () => {},
        moderator: null,
      }
    );
    const output = JSON.parse(result.content[0].text);
    expect(output.jobs).toHaveLength(120);
    expect(
      output.jobs.every((j: { steps: unknown[] }) => j.steps.length === 3)
    ).toBe(true);
  });

  it('原子取消运行及其所有待处理作业和步骤', async () => {
    const s = await largeRun();
    const res = await call(
      s.t,
      '/api/repos/octocat/app/actions/runs/1/cancel',
      { cookie: s.admin, method: 'POST' }
    );
    expect(res.status).toBe(200);
    await settle(s.t);
    expect((await s.db.select().from(workflowRuns).get())?.conclusion).toBe(
      'cancelled'
    );
    const jobs = await s.db.select().from(workflowJobs);
    const steps = await s.db.select().from(workflowSteps);
    expect(jobs).toHaveLength(120);
    expect(steps).toHaveLength(360);
    expect(
      jobs.every(
        (j) => j.status === 'completed' && j.conclusion === 'cancelled'
      )
    ).toBe(true);
    expect(
      steps.every(
        (st) => st.status === 'completed' && st.conclusion === 'skipped'
      )
    ).toBe(true);
  });

  it('为所有选中的运行器会话记录停止状态，且不影响其他作业', async () => {
    const s = await largeRun();
    const inserts = s.planned.map((j) =>
      s.db.insert(runnerSessions).values({
        id: j.id,
        jobId: j.id,
        repositoryId: s.run.repositoryId,
        instanceType: 'standard-1',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60_000),
      })
    );
    await s.db.batch([inserts[0], ...inserts.slice(1)]);
    const ids = s.planned.slice(0, 119).map((j) => j.id);
    await runnersStopped(s.db, ids);
    const open = await s.db
      .select()
      .from(runnerSessions)
      .where(isNull(runnerSessions.stoppedAt));
    expect(open.map((r) => r.jobId)).toEqual([s.planned[119].id]);
  });
});
