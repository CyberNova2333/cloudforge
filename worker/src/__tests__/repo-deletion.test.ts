import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { recoverRepositoryDeletions } from '../lib/repo-deletion';
import { call } from './helpers/app';
import { CI, pushFiles, setup, type Setup } from './helpers/actions';
import { actionsQueue } from '../actions/queue';

const remove = (s: Setup) =>
  call(s.t, '/api/repos/octocat/app', { cookie: s.admin, method: 'DELETE' });
const deletion = (s: Setup) =>
  s.t.env.DB.prepare(
    'SELECT completed, attempts, finished_at FROM repository_deletions'
  ).first<{
    completed: string;
    attempts: number;
    finished_at: number | null;
  }>();

describe('删除仓库', () => {
  it('删除记录与仓库行一起写入，存储清理完成后标记完成', async () => {
    const s = await setup();
    const name = s.repo.name;
    expect((await remove(s)).status).toBe(200);
    expect(
      await s.t.env.DB.prepare('SELECT count(*) AS n FROM repositories').first()
    ).toMatchObject({ n: 0 });
    expect(s.t.fake.repos.has(name)).toBe(false);
    const row = (await deletion(s))!;
    expect(JSON.parse(row.completed)).toEqual({
      artifacts: true,
      lfs: true,
      actions: true,
    });
    expect(row.finished_at).not.toBeNull();
  });

  it('清理失败的步骤留待每日恢复，已完成的步骤不重做，删除请求本身仍然成功', async () => {
    const s = await setup();
    const list = vi
      .spyOn(s.t.env.ACTIONS_LOGS, 'list')
      .mockRejectedValue(new Error('R2 unavailable'));
    const artifacts = vi.spyOn(s.t.fake.binding, 'delete');
    try {
      expect((await remove(s)).status).toBe(200);
      const row = (await deletion(s))!;
      expect(JSON.parse(row.completed)).toEqual({
        artifacts: true,
        lfs: true,
      });
      expect(row.finished_at).toBeNull();
    } finally {
      list.mockRestore();
    }
    const db = drizzle(s.t.env.DB, { schema });
    expect(await recoverRepositoryDeletions(s.t.env, db)).toBe(1);
    expect((await deletion(s))!.finished_at).not.toBeNull();
    // The Artifacts repository was deleted once, not again by the recovery.
    expect(artifacts).toHaveBeenCalledTimes(1);
    artifacts.mockRestore();
  });

  it('停止仍在进行的 Actions 运行', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const run = (await s.t.env.DB.prepare(
      'SELECT id FROM workflow_runs'
    ).first<{ id: string }>())!;
    await s.t.env.DB.prepare(
      "UPDATE workflow_jobs SET status='in_progress' WHERE run_id=?"
    )
      .bind(run.id)
      .run();
    expect((await remove(s)).status).toBe(200);
    expect(s.t.actions.terminated).toContain(run.id);
    expect(s.t.actions.destroyed.length).toBeGreaterThan(0);
  });

  it.each(['workflow', 'container'])(
    '%s停止失败时不删除仓库、运行与容量追踪，也不开始存储清理',
    async (failure) => {
      const s = await setup();
      await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
      const run = (await s.t.env.DB.prepare(
        'SELECT id,repository_id FROM workflow_runs'
      ).first<{ id: string; repository_id: string }>())!;
      const job = (await s.t.env.DB.prepare(
        'SELECT id FROM workflow_jobs WHERE run_id=?'
      )
        .bind(run.id)
        .first<{ id: string }>())!;
      await s.t.env.DB.batch([
        s.t.env.DB.prepare(
          "UPDATE workflow_runs SET status='in_progress' WHERE id=?"
        ).bind(run.id),
        s.t.env.DB.prepare(
          "UPDATE workflow_jobs SET status='in_progress' WHERE id=?"
        ).bind(job.id),
      ]);
      const queue = actionsQueue(s.t.env);
      expect(
        await queue.acquire({
          jobId: job.id,
          runId: run.id,
          maxMinutes: 10,
          limit: 1,
          repositoryId: run.repository_id,
        })
      ).toMatchObject({ granted: true });
      await queue.started(job.id);
      const failureCall = vi
        .fn()
        .mockRejectedValue(new Error('stop unavailable'));
      const getRun = s.t.env.ACTIONS_RUN.get.bind(s.t.env.ACTIONS_RUN);
      const getRunner = s.t.env.JOB_RUNNER.getByName.bind(s.t.env.JOB_RUNNER);
      const workflow = vi
        .spyOn(s.t.env.ACTIONS_RUN, 'get')
        .mockImplementation(async (id) => {
          const instance = await getRun(id);
          return failure === 'workflow'
            ? Object.assign(instance, { terminate: failureCall })
            : instance;
        });
      const runner = vi
        .spyOn(s.t.env.JOB_RUNNER, 'getByName')
        .mockImplementation((id) => {
          const instance = getRunner(id);
          return failure === 'container'
            ? Object.assign(instance, { destroy: failureCall })
            : instance;
        });
      try {
        const response = await remove(s);
        expect(response.status).toBe(409);
        const probe = await queue.acquire({
          jobId: crypto.randomUUID(),
          runId: crypto.randomUUID(),
          maxMinutes: 10,
          limit: 1,
        });
        const snapshot = {
          rejected: response.status >= 400,
          failedStopAttempted: failureCall.mock.calls.length > 0,
          repository: await s.t.env.DB.prepare(
            'SELECT id FROM repositories WHERE id=?'
          )
            .bind(run.repository_id)
            .first(),
          run: await s.t.env.DB.prepare(
            'SELECT id FROM workflow_runs WHERE id=?'
          )
            .bind(run.id)
            .first(),
          reservation: await s.t.env.DB.prepare(
            'SELECT id,status FROM workflow_jobs WHERE id=?'
          )
            .bind(job.id)
            .first(),
          deletion: await deletion(s),
          storagePresent: s.t.fake.repos.has(s.repo.name),
          capacityRetained: !probe.granted,
        };
        expect(snapshot).toEqual({
          rejected: true,
          failedStopAttempted: true,
          repository: { id: run.repository_id },
          run: { id: run.id },
          reservation: { id: job.id, status: 'in_progress' },
          deletion: null,
          storagePresent: true,
          capacityRetained: true,
        });
      } finally {
        workflow.mockRestore();
        runner.mockRestore();
      }
      // The run is already fenced, but the retained in-progress job must still be found on retry.
      expect((await remove(s)).status).toBe(200);
      expect((await deletion(s))!.finished_at).not.toBeNull();
      expect(s.t.fake.repos.has(s.repo.name)).toBe(false);
    }
  );

  it.each(['queued', 'reserved'])(
    '预停止后新%s运行阻止最终删除，未留清理outbox且可重试完成',
    async (kind) => {
      const s = await setup();
      await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
      const oldRun = (await s.t.env.DB.prepare(
        'SELECT id,repository_id FROM workflow_runs'
      ).first<{ id: string; repository_id: string }>())!;
      const racedRunId = crypto.randomUUID();
      const racedJobId = crypto.randomUUID();
      const getRun = s.t.env.ACTIONS_RUN.get.bind(s.t.env.ACTIONS_RUN);
      let inserted = false;
      const workflow = vi
        .spyOn(s.t.env.ACTIONS_RUN, 'get')
        .mockImplementation(async (id) => {
          const instance = await getRun(id);
          const terminate = instance.terminate.bind(instance);
          return Object.assign(instance, {
            terminate: async () => {
              await terminate();
              if (inserted) return;
              inserted = true;
              // Simulate another trigger after the stop snapshot, before the final D1 deletion batch.
              await s.t.env.DB.prepare(
                'INSERT INTO workflow_runs (id,repository_id,run_number,workflow_path,name,event,ref,head_sha,display_title,status,created_at) SELECT ?,repository_id,run_number+1,workflow_path,name,event,ref,head_sha,display_title,?,created_at FROM workflow_runs WHERE id=?'
              )
                .bind(
                  racedRunId,
                  kind === 'queued' ? 'queued' : 'completed',
                  oldRun.id
                )
                .run();
              if (kind === 'reserved')
                await s.t.env.DB.prepare(
                  "INSERT INTO workflow_jobs (id,run_id,job_key,name,runs_on,needs,status) SELECT ?,?,job_key,name,runs_on,needs,'in_progress' FROM workflow_jobs WHERE run_id=? LIMIT 1"
                )
                  .bind(racedJobId, racedRunId, oldRun.id)
                  .run();
              await s.t.env.ACTIONS_RUN.create({
                id: racedRunId,
                params: { runId: racedRunId },
              });
            },
          });
        });
      try {
        expect((await remove(s)).status).toBe(409);
        expect(inserted).toBe(true);
        expect(
          await s.t.env.DB.prepare('SELECT id FROM repositories WHERE id=?')
            .bind(oldRun.repository_id)
            .first()
        ).toEqual({ id: oldRun.repository_id });
        expect(
          await s.t.env.DB.prepare('SELECT id FROM workflow_runs WHERE id=?')
            .bind(racedRunId)
            .first()
        ).toEqual({ id: racedRunId });
        expect(await deletion(s)).toBeNull();
        expect(s.t.fake.repos.has(s.repo.name)).toBe(true);
        expect(
          await s.t.env.DB.prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='repository.deleted'"
          ).first()
        ).toEqual({ n: 0 });
      } finally {
        workflow.mockRestore();
      }
      expect((await remove(s)).status).toBe(200);
      expect(s.t.actions.terminated).toContain(racedRunId);
      if (kind === 'reserved')
        expect(s.t.actions.destroyed).toContain(racedJobId);
      expect((await deletion(s))!.finished_at).not.toBeNull();
      expect(s.t.fake.repos.has(s.repo.name)).toBe(false);
    }
  );

  it('运行过多时有界停止并保留仓库，重试继续剩余运行后再清理', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const first = (await s.t.env.DB.prepare(
      'SELECT id,repository_id FROM workflow_runs'
    ).first<{ id: string; repository_id: string }>())!;
    const remaining = Array.from({ length: 20 }, () => crypto.randomUUID());
    await s.t.env.DB.prepare(
      "INSERT INTO workflow_runs (id,repository_id,run_number,workflow_path,name,event,ref,head_sha,display_title,status,created_at) SELECT e.value,r.repository_id,r.run_number+CAST(e.key AS INTEGER)+1,r.workflow_path,r.name,r.event,r.ref,r.head_sha,r.display_title,'queued',r.created_at FROM json_each(?) e JOIN workflow_runs r ON r.id=?"
    )
      .bind(JSON.stringify(remaining), first.id)
      .run();
    await Promise.all(
      remaining.map((id) =>
        s.t.env.ACTIONS_RUN.create({ id, params: { runId: id } })
      )
    );
    expect((await remove(s)).status).toBe(409);
    expect(s.t.actions.terminated).toHaveLength(20);
    expect(
      await s.t.env.DB.prepare('SELECT id FROM repositories WHERE id=?')
        .bind(first.repository_id)
        .first()
    ).toEqual({ id: first.repository_id });
    expect(await deletion(s)).toBeNull();
    expect(s.t.fake.repos.has(s.repo.name)).toBe(true);
    expect((await remove(s)).status).toBe(200);
    expect(s.t.actions.terminated).toHaveLength(21);
    // Queued runs never started a runner; fencing their Workflow does not invent a container to destroy.
    expect(s.t.actions.destroyed).toHaveLength(0);
    expect((await deletion(s))!.finished_at).not.toBeNull();
    expect(s.t.fake.repos.has(s.repo.name)).toBe(false);
  });

  it('D1最终删除零行时撤回同批outbox，不能清理仍存在仓库的存储', async () => {
    const s = await setup();
    await s.t.env.DB.prepare(
      'CREATE TRIGGER test_retain_repository BEFORE DELETE ON repositories BEGIN SELECT RAISE(IGNORE); END'
    ).run();
    try {
      expect((await remove(s)).status).toBe(409);
      expect(
        await s.t.env.DB.prepare(
          'SELECT count(*) AS n FROM repositories'
        ).first()
      ).toEqual({ n: 1 });
      expect(await deletion(s)).toBeNull();
      expect(s.t.fake.repos.has(s.repo.name)).toBe(true);
      expect(
        await s.t.env.DB.prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action='repository.deleted'"
        ).first()
      ).toEqual({ n: 0 });
    } finally {
      await s.t.env.DB.prepare('DROP TRIGGER test_retain_repository').run();
    }
    expect((await remove(s)).status).toBe(200);
    expect((await deletion(s))!.finished_at).not.toBeNull();
    expect(s.t.fake.repos.has(s.repo.name)).toBe(false);
  });
});
