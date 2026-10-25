import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { recoverRepositoryDeletions } from '../lib/repo-deletion';
import { call } from './helpers/app';
import { CI, pushFiles, setup, type Setup } from './helpers/actions';

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
    expect((await remove(s)).status).toBe(200);
    expect(s.t.actions.terminated).toContain(run.id);
    expect(s.t.actions.destroyed.length).toBeGreaterThan(0);
  });
});
