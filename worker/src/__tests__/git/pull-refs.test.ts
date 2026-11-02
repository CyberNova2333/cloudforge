import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import { prunePullRefs } from '../../pulls/refs';
import { appRepo, openPull } from '../helpers/reviews';
import { FakeRepo } from '../helpers/fake-artifacts';

/** Bulk seed real D1 without creating dozens of repositories through HTTP. */
async function backlog(count: number) {
  const { t } = await appRepo();
  const source = (await t.env.DB.prepare(
    'SELECT id FROM repositories LIMIT 1'
  ).first<{ id: string }>())!;
  const ids = Array.from(
    { length: count },
    (_, i) => `cleanup-${String(i).padStart(3, '0')}`
  );
  const old = Math.floor(Date.now() / 1000) - 31 * 86_400;
  await t.env.DB.batch([
    t.env.DB.prepare(
      `INSERT INTO repositories (id, owner_id, name, artifacts_name, created_at, updated_at)
       SELECT j.value, r.owner_id, j.value, 'r_' || j.value, r.created_at, r.updated_at
       FROM repositories r, json_each(?) j WHERE r.id = ?`
    ).bind(JSON.stringify(ids), source.id),
    t.env.DB.prepare(
      `INSERT INTO pull_requests
         (id, repository_id, number, title, author_id, base_ref, head_ref, state, closed_at, created_at, updated_at)
       SELECT j.value || ':pr', j.value, 1, 'Old pull', r.owner_id, 'main', 'feature', 'closed', ?, ?, ?
       FROM json_each(?) j JOIN repositories r ON r.id = j.value`
    ).bind(old, old, old, JSON.stringify(ids)),
  ]);
  const ref = 'refs/pull/1/pre-rebase/aaaaaaa';
  const repos = ids.map((id) => {
    const repo = new FakeRepo(`r_${id}`);
    repo.refs.set(ref, 'a'.repeat(40));
    t.fake.repos.set(repo.name, repo);
    return repo;
  });
  return { t, repos, ref, db: drizzle(t.env.DB, { schema }) };
}

describe('清理已关闭 PR 的簿记引用', () => {
  it('关闭超过 30 天的 PR 删除 pre-rebase 与 landings 引用，保留其 head、未关闭的 PR 和未完成落地的回执', async () => {
    const { t, admin, repo } = await appRepo();
    const one = await openPull(
      t,
      admin,
      repo,
      { 'a.txt': '1\n' },
      { branch: 'one' }
    );
    await openPull(t, admin, repo, { 'b.txt': '2\n' }, { branch: 'two' });
    await openPull(t, admin, repo, { 'c.txt': '3\n' }, { branch: 'three' });
    const sha = one.head;
    const old = Math.floor(Date.now() / 1000) - 31 * 86_400;
    await t.env.DB.prepare(
      "UPDATE pull_requests SET state = 'closed', closed_at = ? WHERE number IN (1, 3)"
    )
      .bind(old)
      .run();
    // A landing of #3 that never finished: recovery still reads its receipt.
    const pr3 = (await t.env.DB.prepare(
      'SELECT id, repository_id FROM pull_requests WHERE number = 3'
    ).first<{ id: string; repository_id: string }>())!;
    await t.env.DB.prepare(
      `INSERT INTO landing_intents (id, pull_request_id, repository_id, target, base_sha, head_sha, land_head_sha,
         pull_ref_before, landed_commits, automatic, created_at, completed)
       VALUES ('l3', ?, ?, 'main', ?, ?, ?, ?, 1, 0, ?, '{}')`
    )
      .bind(pr3.id, pr3.repository_id, sha, sha, sha, sha, old)
      .run();
    for (const ref of [
      'refs/pull/1/pre-rebase/aaaaaaa',
      'refs/pull/1/landings/l1',
      'refs/pull/2/pre-rebase/bbbbbbb',
      'refs/pull/3/landings/l3',
      'refs/pull/3/pre-rebase/ccccccc',
    ])
      repo.refs.set(ref, sha);
    const heads = [...repo.refs.keys()].filter((r) => r.endsWith('/head'));

    const db = drizzle(t.env.DB, { schema });
    expect(await prunePullRefs(t.env, db)).toBe(3);
    const left = [...repo.refs.keys()].filter((r) =>
      r.startsWith('refs/pull/')
    );
    expect(left.filter((r) => !r.endsWith('/head')).sort()).toEqual([
      'refs/pull/2/pre-rebase/bbbbbbb',
      'refs/pull/3/landings/l3',
    ]);
    for (const h of heads) expect(repo.refs.has(h)).toBe(true);
    // Nothing left to do on the next run.
    expect(await prunePullRefs(t.env, db)).toBe(0);
  });

  it('关闭不满 30 天的 PR 不清理', async () => {
    const { t, admin, repo } = await appRepo();
    const one = await openPull(
      t,
      admin,
      repo,
      { 'a.txt': '1\n' },
      { branch: 'one' }
    );
    await t.env.DB.prepare(
      "UPDATE pull_requests SET state = 'closed', closed_at = ? WHERE number = 1"
    )
      .bind(Math.floor(Date.now() / 1000) - 3 * 86_400)
      .run();
    repo.refs.set('refs/pull/1/pre-rebase/aaaaaaa', one.head);
    expect(await prunePullRefs(t.env, drizzle(t.env.DB, { schema }))).toBe(0);
    expect(repo.refs.has('refs/pull/1/pre-rebase/aaaaaaa')).toBe(true);
  });

  it('定时任务长期停摆后仍清理关闭 90 天的 PR', async () => {
    const { t, admin, repo } = await appRepo();
    const one = await openPull(t, admin, repo, { 'a.txt': 'old\n' });
    await t.env.DB.prepare(
      "UPDATE pull_requests SET state = 'closed', closed_at = ? WHERE number = 1"
    )
      .bind(Math.floor(Date.now() / 1000) - 90 * 86_400)
      .run();
    const ref = 'refs/pull/1/pre-rebase/aaaaaaa';
    repo.refs.set(ref, one.head);
    expect(await prunePullRefs(t.env, drizzle(t.env.DB, { schema }))).toBe(1);
    expect(repo.refs.has(ref)).toBe(false);
    expect(repo.refs.has('refs/pull/1/head')).toBe(true);
  });

  it('每次至多清理 50 个仓库且后续运行推进到剩余仓库', async () => {
    const { t, repos, ref, db } = await backlog(51);
    expect(await prunePullRefs(t.env, db)).toBe(50);
    expect(repos.filter((repo) => repo.refs.has(ref))).toHaveLength(1);
    // A fresh DB wrapper resumes durable progress; already scanned repositories still have old closed PR rows.
    expect(await prunePullRefs(t.env, drizzle(t.env.DB, { schema }))).toBe(1);
    expect(repos.every((repo) => !repo.refs.has(ref))).toBe(true);
  });

  it('仓库读取失败不会阻止后续批次，绕回后重试失败仓库', async () => {
    const { t, repos, ref, db } = await backlog(51);
    const unavailable = vi
      .spyOn(repos[0], 'advertisement')
      .mockImplementation(() => {
        throw new Error('Artifacts temporarily unavailable');
      });
    try {
      expect(await prunePullRefs(t.env, db)).toBe(49);
      expect(await prunePullRefs(t.env, db)).toBe(1);
      expect(repos.filter((repo) => repo.refs.has(ref))).toEqual([repos[0]]);
    } finally {
      unavailable.mockRestore();
    }
    expect(await prunePullRefs(t.env, db)).toBe(1);
    expect(repos.every((repo) => !repo.refs.has(ref))).toBe(true);
  });
});
