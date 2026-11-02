// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { call, type TestEnv } from '../helpers/app';
import { commitFiles } from '../helpers/seed';
import {
  divergedPull,
  fakeResolver,
  moved,
  NOTES,
  runRebases,
} from '../helpers/rebase';

export async function listed(t: TestEnv, cookie: string, state = 'open') {
  const body = (await (
    await call(t, `/api/repos/octocat/app/pulls?state=${state}`, { cookie })
  ).json()) as { pulls: { number: number; aiResolution: string | null }[] };
  return Object.fromEntries(body.pulls.map((p) => [p.number, p.aiResolution]));
}

describe('拉取请求列表：AI 正在解决变基冲突', () => {
  it('不把 AI 从未尝试的中止（模型为 none）称为 AI 冲突解决', async () => {
    const { t, admin, root } = await divergedPull({ conflict: true });
    await moved(t, 'main', root);
    await runRebases(t); // no resolver: the run stops for the agent
    expect(await listed(t, admin)).toEqual({ 1: null });
  });

  it('仅在所属拉取请求上展示运行中及随后失败的冲突解决记录', async () => {
    const { t, admin, repo, root } = await divergedPull({ conflict: true });
    await commitFiles(
      repo,
      'clean',
      { 'notes.txt': NOTES, 'c.txt': 'c\n' },
      'Clean',
      [root]
    );
    await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'Clean', body: '', base: 'main', head: 'clean' },
    });
    await moved(t, 'main', root);
    let during: Record<string, string | null> = {};
    const { resolver } = fakeResolver(async () => {
      during = await listed(t, admin);
      return { status: 'unanswered', reason: 'gave up' };
    });
    await runRebases(t, { resolver });
    expect(during[1]).toBe('running');
    expect(await listed(t, admin)).toEqual({ 1: 'failed', 2: null });
  });

  it('忽略分支已越过的旧端点记录，并排除已关闭的拉取请求', async () => {
    const { t, admin, repo, root } = await divergedPull({ conflict: true });
    await moved(t, 'main', root);
    await runRebases(t, {
      resolver: fakeResolver(() => ({ status: 'unanswered' })).resolver,
    });
    await commitFiles(
      repo,
      'main',
      { 'notes.txt': NOTES.replace('three', 'THREE (main)'), 'z.txt': 'z\n' },
      'More'
    );
    expect(await listed(t, admin)).toEqual({ 1: null });
    await call(t, '/api/repos/octocat/app/pulls/1', {
      cookie: admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    expect(await listed(t, admin, 'closed')).toEqual({ 1: null });
  });
});
