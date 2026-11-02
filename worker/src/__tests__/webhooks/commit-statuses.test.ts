import { describe, expect, it } from 'vitest';
import { addMember, call, settle, type TestEnv } from '../helpers/app';
import { setup } from '../helpers/actions';
import { commitFiles } from '../helpers/seed';

const base = '/api/repos/octocat/app';

const report = (
  t: TestEnv,
  sha: string,
  json: Record<string, unknown>,
  auth: { cookie?: string; token?: string }
) =>
  call(t, `${base}/statuses/${sha}`, {
    json,
    cookie: auth.cookie,
    headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
  });

async function readToken(t: TestEnv, cookie: string) {
  const res = await call(t, '/api/tokens', {
    cookie,
    json: { name: 'ci-read', expiresInDays: 30, scope: 'read' },
  });
  return ((await res.json()) as { plaintext: string }).plaintext;
}

describe('提交状态', () => {
  it('用令牌上报，按 context 取最新得出合并状态；只读令牌只能读', async () => {
    const s = await setup();
    const sha = s.repo.refs.get('refs/heads/main')!;
    const ok = await report(
      s.t,
      sha,
      {
        state: 'pending',
        context: 'ci/build',
        target_url: 'https://ci.example.com/1',
        description: 'Building',
      },
      { token: s.token }
    );
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({
      sha,
      state: 'pending',
      context: 'ci/build',
      target_url: 'https://ci.example.com/1',
      creator: { login: 'octocat' },
    });
    await report(
      s.t,
      sha,
      { state: 'success', context: 'ci/build' },
      { token: s.token }
    );
    await report(s.t, sha, { state: 'success' }, { cookie: s.admin });

    const combined = (await (
      await call(s.t, `${base}/commits/main/status`, {
        headers: { Authorization: `token ${s.token}` },
      })
    ).json()) as {
      state: string;
      total_count: number;
      statuses: { context: string; state: string }[];
    };
    expect(combined).toMatchObject({ state: 'success', total_count: 2 });
    expect(combined.statuses.map((x) => [x.context, x.state])).toEqual([
      ['ci/build', 'success'],
      ['default', 'success'],
    ]);
    const all = (await (
      await call(s.t, `${base}/statuses/${sha}`, { cookie: s.admin })
    ).json()) as { state: string }[];
    expect(all.map((x) => x.state)).toEqual(['success', 'success', 'pending']);

    const read = await readToken(s.t, s.admin);
    expect(
      (await report(s.t, sha, { state: 'failure' }, { token: read })).status
    ).toBe(403);
    expect(
      (
        await call(s.t, `${base}/statuses/${sha}`, {
          headers: { Authorization: `Bearer ${read}` },
        })
      ).status
    ).toBe(200);
  });

  it('令牌只在提交状态接口上有效；未知令牌、没有推送权限和不存在的提交被拒绝', async () => {
    const s = await setup();
    const sha = s.repo.refs.get('refs/heads/main')!;
    expect(
      (
        await call(s.t, `${base}/issues`, {
          json: { title: 'via token' },
          headers: { Authorization: `Bearer ${s.token}` },
        })
      ).status
    ).toBe(401);
    expect(
      (await report(s.t, sha, { state: 'success' }, { token: 'nope' })).status
    ).toBe(401);
    const bob = await addMember(s.t, s.admin, 'bob');
    expect(
      (await report(s.t, sha, { state: 'success' }, { cookie: bob })).status
    ).toBe(403);
    expect(
      (
        await report(
          s.t,
          'f'.repeat(40),
          { state: 'success' },
          { cookie: s.admin }
        )
      ).status
    ).toBe(422);
    expect(
      (
        await report(
          s.t,
          sha,
          { state: 'success', target_url: 'javascript:alert(1)' },
          { cookie: s.admin }
        )
      ).status
    ).toBe(400);
  });

  it('失败的状态阻止合并并出现在 PR 状态与检查徽章里，成功后可以合并', async () => {
    const s = await setup();
    const head = await commitFiles(
      s.repo,
      'feature',
      { 'a.txt': 'a' },
      'feat',
      [s.repo.refs.get('refs/heads/main')!]
    );
    const pr = (await (
      await call(s.t, `${base}/pulls`, {
        cookie: s.admin,
        json: { title: 'Feature', base: 'main', head: 'feature' },
      })
    ).json()) as { number: number };
    await report(
      s.t,
      head,
      { state: 'failure', context: 'jenkins' },
      { token: s.token }
    );

    const merge = () =>
      call(s.t, `${base}/pulls/${pr.number}/merge`, {
        cookie: s.admin,
        json: { approve: true },
      });
    const refused = await merge();
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; reason: string };
    expect(body.reason).toBe('checks');
    expect(body.error).toContain('"jenkins" check failed');
    expect(body.error).not.toContain('run #');

    const listed = (await (
      await call(s.t, `${base}/pulls`, { cookie: s.admin })
    ).json()) as {
      pulls: { pullState: { reasons: { kind: string; check?: string }[] } }[];
    };
    expect(listed.pulls[0].pullState.reasons).toContainEqual(
      expect.objectContaining({
        kind: 'check_failed',
        check: 'jenkins',
        run_number: 0,
      })
    );
    const badge = (await (
      await call(s.t, `${base}/commit-statuses?shas=${head}`, {
        cookie: s.admin,
      })
    ).json()) as Record<
      string,
      { state: string; statuses: { context: string }[] }
    >;
    expect(badge[head]).toMatchObject({
      state: 'failure',
      statuses: [{ context: 'jenkins', state: 'failure' }],
    });

    await report(
      s.t,
      head,
      { state: 'pending', context: 'jenkins' },
      { token: s.token }
    );
    expect((await merge()).status).toBe(409);
    await report(
      s.t,
      head,
      { state: 'success', context: 'jenkins' },
      { token: s.token }
    );
    await settle(s.t);
    expect((await merge()).status).toBe(200);
  });
});
