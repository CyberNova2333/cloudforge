// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { refreshAgentConfig } from '../agents/refresh';
import {
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from './helpers/app';
import { pat, push } from './helpers/actions';
import { agentRepo, agentRow, newAgent } from './helpers/agents';
import { commitFiles, commitPaths } from './helpers/seed';
import type { FakeRepo } from './helpers/fake-artifacts';

const AGENT = (name: string, above = '0.3') => `---
name: ${name}
bio: Reviews authentication.
trigger:
  ask: Does this touch authentication?
  above: ${above}
engine: pi
---
Look for leaked secrets.
`;

async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  await newAgent(t, admin);
  return { t, admin, repo: await agentRepo(t), token: await pat(t, admin) };
}

/** Commits `files` on top of `branch` and pushes them to the agent repository. */
async function pushTo(
  s: { t: TestEnv; repo: FakeRepo; token: string },
  branch: string,
  files: Record<string, string>
) {
  const old = s.repo.refs.get(`refs/heads/${branch}`) ?? '0'.repeat(40);
  const sha = await commitPaths(s.repo, branch, files, 'Edit agent', {
    moveRef: false,
  });
  await push(
    s.t,
    s.token,
    '/secagent/secagent.git',
    `refs/heads/${branch}`,
    old,
    sha
  );
  return sha;
}

describe('从 AGENT.md 刷新智能体', () => {
  it('缓存推送到默认分支的有效 AGENT.md', async () => {
    const s = await setup();
    const sha = await pushTo(s, 'main', { 'AGENT.md': AGENT('Auth Agent') });
    expect(await agentRow(s.t)).toMatchObject({
      name: 'Auth Agent',
      bio: 'Reviews authentication.',
      trigger_ask: 'Does this touch authentication?',
      trigger_above: 0.3,
      engine: 'pi',
      config_sha: sha,
      config_error: null,
      // The profile name follows AGENT.md; no avatar.png → the generated avatar.
      user_name: 'Auth Agent',
      user_image: null,
    });
  });

  it('缓存颜色、领域和 guarded 标记，AGENT.md 移除这些字段时清除缓存', async () => {
    const s = await setup();
    const withMeta = AGENT('Auth Agent').replace(
      'engine: pi\n',
      'engine: pi\ncolor: "#2A78D6"\nfacet: security\nguarded: true\n'
    );
    await pushTo(s, 'main', { 'AGENT.md': withMeta });
    expect(await agentRow(s.t)).toMatchObject({
      color: '#2a78d6',
      facet: 'security',
      guarded: 1,
    });
    await pushTo(s, 'main', { 'AGENT.md': AGENT('Auth Agent') });
    expect(await agentRow(s.t)).toMatchObject({
      color: null,
      facet: null,
      guarded: 0,
    });
  });

  it('存储有效保护状态：所有安全或数据领域智能体均受保护，不受 AGENT.md 声明影响', async () => {
    const s = await setup();
    const withFront = (front: string) =>
      AGENT('Auth Agent').replace('engine: pi\n', `engine: pi\n${front}`);
    const guarded = async () => (await agentRow(s.t))!.guarded;
    // A facet that guards, with no guarded key.
    await pushTo(s, 'main', { 'AGENT.md': withFront('facet: security\n') });
    expect(await guarded()).toBe(1);
    await pushTo(s, 'main', { 'AGENT.md': withFront('facet: data\n') });
    expect(await guarded()).toBe(1);
    // guarded: false can't unguard them.
    await pushTo(s, 'main', {
      'AGENT.md': withFront('facet: data\nguarded: false\n'),
    });
    expect(await guarded()).toBe(1);
    // Moving to another facet updates the column.
    await pushTo(s, 'main', { 'AGENT.md': withFront('facet: speed\n') });
    expect(await guarded()).toBe(0);
    await pushTo(s, 'main', {
      'AGENT.md': withFront('facet: speed\nguarded: true\n'),
    });
    expect(await guarded()).toBe(1);
    // The column and the API always agree.
    const agents = (await (
      await call(s.t, '/api/agents', { cookie: s.admin })
    ).json()) as { guarded: boolean }[];
    expect(agents[0].guarded).toBe(true);
  });

  it('存在 avatar.png 时，将头像指向推送的提交', async () => {
    const s = await setup();
    const sha = await pushTo(s, 'main', {
      'AGENT.md': AGENT('Auth Agent'),
      'avatar.png': 'not really a png',
    });
    expect((await agentRow(s.t))!.user_image).toBe(
      `/api/agents/secagent/avatar?v=${sha}`
    );
  });

  it('保留最近一次有效字段，并记录错误', async () => {
    const s = await setup();
    const good = await pushTo(s, 'main', { 'AGENT.md': AGENT('Auth Agent') });
    await pushTo(s, 'main', { 'AGENT.md': AGENT('Broken', '1') });
    expect(await agentRow(s.t)).toMatchObject({
      name: 'Auth Agent',
      user_name: 'Auth Agent',
      config_sha: good,
      config_error: expect.stringContaining('trigger.above'),
    });
    const fixed = await pushTo(s, 'main', { 'AGENT.md': AGENT('Fixed Agent') });
    expect(await agentRow(s.t)).toMatchObject({
      name: 'Fixed Agent',
      config_sha: fixed,
      config_error: null,
    });
  });

  it('默认分支不接受强制推送回旧提交；推送恢复有效内容的新提交后清除错误', async () => {
    const s = await setup();
    const good = await pushTo(s, 'main', { 'AGENT.md': AGENT('Auth Agent') });
    const bad = await pushTo(s, 'main', { 'AGENT.md': 'no frontmatter' });
    expect((await agentRow(s.t))!.config_error).not.toBeNull();
    // Rewinding main is a force push: undone, so main and the error stay.
    await push(
      s.t,
      s.token,
      '/secagent/secagent.git',
      'refs/heads/main',
      bad,
      good
    );
    expect(s.repo.refs.get('refs/heads/main')).toBe(bad);
    expect((await agentRow(s.t))!.config_error).not.toBeNull();
    const fixed = await pushTo(s, 'main', { 'AGENT.md': AGENT('Auth Agent') });
    expect(await agentRow(s.t)).toMatchObject({
      config_sha: fixed,
      config_error: null,
    });
  });

  it('忽略推送至其他分支的内容', async () => {
    const s = await setup();
    const before = await agentRow(s.t);
    await pushTo(s, 'draft', { 'AGENT.md': AGENT('Draft Agent') });
    expect(await agentRow(s.t)).toEqual(before);
  });

  it('拉取请求合并到默认分支时刷新', async () => {
    const s = await setup();
    const main = s.repo.refs.get('refs/heads/main')!;
    await commitFiles(
      s.repo,
      'edit',
      { 'AGENT.md': AGENT('Merged Agent') },
      'Edit',
      [main]
    );
    await call(s.t, '/api/repos/secagent/secagent/pulls', {
      cookie: s.admin,
      json: { title: 'Rename', base: 'main', head: 'edit' },
    });
    const res = await call(s.t, '/api/repos/secagent/secagent/pulls/1/merge', {
      cookie: s.admin,
      json: { approve: true },
    });
    expect(res.status).toBe(200);
    await settle(s.t);
    expect(await agentRow(s.t)).toMatchObject({
      name: 'Merged Agent',
      config_sha: s.repo.refs.get('refs/heads/main'),
    });
  });

  it('不处理已删除智能体', async () => {
    const s = await setup();
    await call(s.t, '/api/admin/agents/secagent', {
      cookie: s.admin,
      method: 'DELETE',
    });
    const before = await agentRow(s.t);
    await pushTo(s, 'main', { 'AGENT.md': AGENT('Ghost Agent') });
    expect(await agentRow(s.t)).toEqual(before);
  });

  /** A db whose first batch runs `between` just before it (a write that lands between read and write). */
  function racingDb(t: TestEnv, between: () => Promise<void>) {
    const db = drizzle(t.env.DB, { schema });
    let raced = false;
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'batch') return Reflect.get(target, prop, receiver);
        return async (stmts: Parameters<typeof db.batch>[0]) => {
          if (!raced) {
            raced = true;
            await between();
          }
          return target.batch(stmts);
        };
      },
    });
  }

  it('新刷新已记录提交后，过期刷新不写入任何内容', async () => {
    const s = await setup();
    await commitPaths(
      s.repo,
      'main',
      { 'AGENT.md': AGENT('Stale Agent') },
      'Edit'
    );
    const { repository_id } = (await agentRow(s.t))!;
    let newer = '';
    // A newer push lands, and its refresh records it, between this one's read and its write.
    const racing = racingDb(s.t, async () => {
      newer = await commitPaths(
        s.repo,
        'main',
        { 'AGENT.md': AGENT('Newer Agent') },
        'Edit again'
      );
      await s.t.env.DB.prepare(
        `UPDATE agents SET name = 'Newer Agent', config_sha = ? WHERE repository_id = ?`
      )
        .bind(newer, repository_id)
        .run();
    });
    const before = await agentRow(s.t);
    await refreshAgentConfig(s.t.env, racing, repository_id!);
    const after = await agentRow(s.t);
    expect(after).toEqual({
      ...before,
      name: 'Newer Agent',
      config_sha: newer,
    });
    // The users row (display name, avatar) was not touched either.
    expect({ name: after!.user_name, image: after!.user_image }).toEqual({
      name: before!.user_name,
      image: before!.user_image,
    });
  });

  it('刷新比较并交换失败后重试一次，最终收敛到最新头提交', async () => {
    const s = await setup();
    await commitPaths(
      s.repo,
      'main',
      { 'AGENT.md': AGENT('Stale Agent') },
      'Edit'
    );
    const { repository_id } = (await agentRow(s.t))!;
    let newest = '';
    // Between read and write: an older refresh records an interim commit, and the branch moves on.
    const racing = racingDb(s.t, async () => {
      newest = await commitPaths(
        s.repo,
        'main',
        { 'AGENT.md': AGENT('Newest Agent') },
        'Edit again'
      );
      await s.t.env.DB.prepare(
        `UPDATE agents SET name = 'Interim Agent', config_sha = ? WHERE repository_id = ?`
      )
        .bind('f'.repeat(40), repository_id)
        .run();
    });
    await refreshAgentConfig(s.t.env, racing, repository_id!);
    expect(await agentRow(s.t)).toMatchObject({
      name: 'Newest Agent',
      config_sha: newest,
      config_error: null,
      user_name: 'Newest Agent',
    });
  });

  it('读取期间默认分支发生变化时不写入任何内容', async () => {
    const s = await setup();
    const read = await commitPaths(
      s.repo,
      'main',
      { 'AGENT.md': AGENT('Read Agent') },
      'Edit'
    );
    const newer = await commitPaths(
      s.repo,
      'main',
      { 'AGENT.md': AGENT('Newer Agent') },
      'Edit again',
      { moveRef: false }
    );
    expect(s.repo.refs.get('refs/heads/main')).toBe(read);
    // A push lands while AGENT.md is being read.
    const get = s.repo.objects.get.bind(s.repo.objects);
    s.repo.objects.get = (sha: string) => {
      const o = get(sha);
      if (o?.type === 'blob') s.repo.refs.set('refs/heads/main', newer);
      return o;
    };
    const before = await agentRow(s.t);
    await refreshAgentConfig(
      s.t.env,
      drizzle(s.t.env.DB, { schema }),
      before!.repository_id!
    );
    expect(await agentRow(s.t)).toEqual(before);
  });
});
