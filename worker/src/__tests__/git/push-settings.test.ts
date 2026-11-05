// CloudForge fork addition (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordPush, runPushEvent } from '../../git/push-events';
import { ZERO_SHA } from '../../git/remote';
import { call, settle } from '../helpers/app';
import { crewRepo, type CrewRepo } from '../helpers/crew';
import { commitPaths } from '../helpers/seed';

afterEach(() => vi.restoreAllMocks());

/** Delay only the fake Artifacts response; D1 and HTTP writes remain real. */
function afterRefSnapshot(before: () => Promise<void>) {
  const fetch = globalThis.fetch;
  let entered = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!entered && url.pathname.endsWith('/info/refs')) {
      entered = true;
      await before();
    }
    return response;
  });
  return () => entered;
}

async function event(s: CrewRepo, commands = true) {
  return recordPush(
    s.db,
    s.repoId,
    null,
    commands ? [{ ref: 'refs/heads/main', old: ZERO_SHA, new: s.main }] : []
  );
}

async function saved(s: CrewRepo) {
  return s.t.env.DB.prepare(
    'SELECT default_branch, updated_at, name FROM repositories WHERE id=?'
  )
    .bind(s.repoId)
    .first<{ default_branch: string; updated_at: number; name: string }>();
}

async function completed(s: CrewRepo, id: string) {
  expect(
    await s.t.env.DB.prepare(
      'SELECT attempts, completed_at IS NOT NULL AS finished FROM push_events WHERE id=?'
    )
      .bind(id)
      .first()
  ).toEqual({ attempts: 1, finished: 1 });
}

describe('推送后续处理与仓库设置交接', () => {
  it('延迟自动选择默认分支保留管理员已保存的默认值，同时更新时间并完成事件', async () => {
    const s = await crewRepo();
    await s.branch('release');
    await s.setRepo('default_branch', 'missing');
    const id = await event(s);
    const entered = afterRefSnapshot(async () => {
      const response = await call(s.t, '/api/repos/octocat/app', {
        cookie: s.admin,
        method: 'PATCH',
        json: { defaultBranch: 'release' },
      });
      expect(response.status).toBe(200);
      expect(await saved(s)).toMatchObject({ default_branch: 'release' });
      // Distinguish a conditional default assignment from skipping the whole activity update.
      await s.setRepo('updated_at', 0);
    });
    expect(await runPushEvent(s.t.env, id)).toBe(true);
    expect(entered()).toBe(true);
    expect(await saved(s)).toMatchObject({ default_branch: 'release' });
    expect((await saved(s))!.updated_at).toBeGreaterThan(0);
    await completed(s, id);
    expect(await runPushEvent(s.t.env, id)).toBe(false);
    await settle(s.t);
  });

  it.each([
    {
      label: '优先main',
      initial: 'missing',
      branches: ['main', 'release'],
      expected: 'main',
    },
    {
      label: '否则首分支',
      initial: 'missing',
      branches: ['z-last', 'a-first'],
      expected: 'a-first',
    },
    {
      label: '保留已有默认',
      initial: 'release',
      branches: ['main', 'release'],
      expected: 'release',
    },
    {
      label: '没有分支',
      initial: 'missing',
      branches: [],
      expected: 'missing',
    },
  ])(
    '$label的正常处理仍更新活动时间并完成事件',
    async ({ initial, branches, expected }) => {
      const s = await crewRepo();
      s.repo.refs.clear();
      for (const branch of branches)
        s.repo.refs.set(`refs/heads/${branch}`, s.main);
      await s.setRepo('default_branch', initial);
      await s.setRepo('updated_at', 0);
      const id = await event(s, false);
      expect(await runPushEvent(s.t.env, id)).toBe(true);
      expect(await saved(s)).toMatchObject({ default_branch: expected });
      expect((await saved(s))!.updated_at).toBeGreaterThan(0);
      await completed(s, id);
    }
  );

  it('同次Actions消费实际写入返回的当前仓库名称', async () => {
    const s = await crewRepo({ actions: true });
    const head = await commitPaths(
      s.repo,
      'main',
      {
        '.github/workflows/ci.yml':
          'name: CI\non: push\njobs:\n  test:\n    name: ${{ github.repository }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
      },
      'workflow'
    );
    const id = await recordPush(s.db, s.repoId, null, [
      { ref: 'refs/heads/main', old: s.main, new: head },
    ]);
    const entered = afterRefSnapshot(async () => {
      const response = await call(s.t, '/api/repos/octocat/app', {
        cookie: s.admin,
        method: 'PATCH',
        json: { name: 'renamed' },
      });
      expect(response.status).toBe(200);
    });
    expect(await runPushEvent(s.t.env, id)).toBe(true);
    expect(entered()).toBe(true);
    expect(await saved(s)).toMatchObject({
      name: 'renamed',
      default_branch: 'main',
    });
    expect(
      (await s.t.env.DB.prepare('SELECT name FROM workflow_jobs').all()).results
    ).toEqual([{ name: 'octocat/renamed' }]);
    await completed(s, id);
    await settle(s.t);
  });

  it('异步读取期间仓库已删除时不再启动后续Actions', async () => {
    const s = await crewRepo({ actions: true });
    const head = await commitPaths(
      s.repo,
      'main',
      {
        '.github/workflows/ci.yml':
          'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
      },
      'workflow'
    );
    const id = await recordPush(s.db, s.repoId, null, [
      { ref: 'refs/heads/main', old: s.main, new: head },
    ]);
    const entered = afterRefSnapshot(async () => {
      await s.t.env.DB.prepare('DELETE FROM repositories WHERE id=?')
        .bind(s.repoId)
        .run();
    });
    expect(await runPushEvent(s.t.env, id)).toBe(true);
    expect(entered()).toBe(true);
    expect(await saved(s)).toBeNull();
    expect(
      (await s.t.env.DB.prepare('SELECT id FROM workflow_runs').all()).results
    ).toEqual([]);
    expect(s.t.actions.started).toEqual([]);
    await settle(s.t);
  });
});
