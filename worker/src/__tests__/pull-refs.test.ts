import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { prunePullRefs } from '../lib/pull-refs';
import { appRepo, openPull } from './helpers/reviews';

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
});
