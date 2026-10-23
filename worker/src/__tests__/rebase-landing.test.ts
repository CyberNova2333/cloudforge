// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from './helpers/app';
import { commitFiles, commitPaths } from './helpers/seed';
import { events } from './helpers/stacking';
import { moved, runRebases } from './helpers/rebase';

const CI = `name: CI
on:
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`;

/** octocat/app; PR #1 from `feature` (Add b, then Add c) into main; `ci` adds a pull_request workflow. */
async function landing(opts: { ci?: boolean } = {}) {
  const t = makeEnv({ actions: true });
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', visibility: 'internal' },
  });
  const repo = [...t.fake.repos.values()][0];
  const base: Record<string, string> = {
    'a.txt': 'a\n',
    ...(opts.ci ? { '.github/workflows/ci.yml': CI } : {}),
  };
  const root = await commitPaths(repo, 'main', base, 'base');
  repo.refs.set('refs/heads/feature', root);
  const f1 = await commitPaths(
    repo,
    'feature',
    { ...base, 'b.txt': 'b\n' },
    'Add b'
  );
  const f2 = await commitPaths(
    repo,
    'feature',
    { ...base, 'b.txt': 'b\n', 'c.txt': 'c\n' },
    'Add c'
  );
  const res = await call(t, '/api/repos/octocat/app/pulls', {
    cookie: admin,
    json: { title: 'B and c', body: '', base: 'main', head: 'feature' },
  });
  expect(res.status).toBe(201);
  await settle(t);
  return {
    t,
    admin,
    repo,
    base,
    root,
    f1,
    f2,
    passChecks: () =>
      t.env.DB.prepare(
        "UPDATE workflow_runs SET status = 'completed', conclusion = 'success'"
      ).run(),
    merge: () =>
      call(t, '/api/repos/octocat/app/pulls/1/merge', {
        cookie: admin,
        json: { approve: true },
      }),
    moveMain: (files: Record<string, string> = { ...base, 'z.txt': 'z\n' }) =>
      commitPaths(repo, 'main', files, 'Main moves'),
  };
}

/**
 * Runs `fn` while every `rebased` timeline insert fails: the work after a written rebase throws partway. The database
 * outlives the test, so the trigger is dropped after.
 */
async function failingRebasedEvents(t: TestEnv, fn: () => Promise<void>) {
  await t.env.DB.prepare(
    "CREATE TRIGGER fail_rebased BEFORE INSERT ON pr_events WHEN NEW.kind = 'rebased' BEGIN SELECT RAISE(ABORT, 'boom'); END"
  ).run();
  try {
    await fn();
  } finally {
    await t.env.DB.prepare('DROP TRIGGER fail_rebased').run();
  }
}

/** Pull request runs on `sha` not yet completed. */
const pendingRuns = (t: TestEnv, sha: string) =>
  t.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM workflow_runs WHERE event = 'pull_request' AND head_sha = ? AND status != 'completed'"
  )
    .bind(sha)
    .first<{ n: number }>();

const row = (t: TestEnv) =>
  t.env.DB.prepare(
    'SELECT state, merge_commit_sha AS sha, landed_commits AS landed FROM pull_requests WHERE number = 1'
  ).first();

describe('通过快进合入', () => {
  it('将目标指向分支头，不创建新提交，保留所有 SHA 和提交说明', async () => {
    const { t, repo, root, f1, f2, merge } = await landing();
    const res = await merge();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha: f2 });
    expect(repo.refs.get('refs/heads/main')).toBe(f2);
    expect(repo.parseCommit(f2)!.parents).toEqual([f1]);
    expect(repo.parseCommit(f1)!.parents).toEqual([root]);
    expect(repo.refs.get('refs/pull/1/head')).toBe(f2);
    expect(await row(t)).toEqual({ state: 'merged', sha: f2, landed: 2 });
  });

  it('即使目标继续前进，仍展示已合入拉取请求自己的提交及文件', async () => {
    const { t, admin, merge, moveMain } = await landing();
    expect((await merge()).status).toBe(200);
    await moveMain();
    const commits = (await (
      await call(t, '/api/repos/octocat/app/pulls/1/commits', { cookie: admin })
    ).json()) as { message: string }[];
    expect(commits.map((c) => c.message)).toEqual(['Add b', 'Add c']);
    const files = (await (
      await call(t, '/api/repos/octocat/app/pulls/1/files', { cookie: admin })
    ).json()) as { path: string }[];
    expect(files.map((f) => f.path)).toEqual(['b.txt', 'c.txt']);
  });

  it('目标变化时先变基，没有待检查事项则立即合入', async () => {
    const { t, repo, f2, merge, moveMain } = await landing();
    const tip = await moveMain();
    const res = await merge();
    expect(res.status).toBe(200);
    const head = repo.refs.get('refs/heads/feature')!;
    expect(head).not.toBe(f2);
    expect(repo.refs.get('refs/heads/main')).toBe(head);
    const top = repo.parseCommit(head)!;
    expect(top.message).toBe('Add c');
    expect(repo.parseCommit(top.parents[0])!.parents).toEqual([tip]);
    expect(repo.refs.get(`refs/pull/1/pre-rebase/${f2.slice(0, 7)}`)).toBe(f2);
    expect(await row(t)).toEqual({ state: 'merged', sha: head, landed: 2 });
    expect((await events(t, 1)).map((e) => e.kind)).toContain('rebased');
  });

  it('先变基，再等待新分支头的检查，再次合入时成功', async () => {
    const { t, repo, base, merge, moveMain, passChecks } = await landing({
      ci: true,
    });
    await passChecks();
    await moveMain({ ...base, 'z.txt': 'z\n' });
    const res = await merge();
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      reason?: string;
      rebased?: string;
    };
    expect(body.error).toMatch(
      /Rebased onto main as [0-9a-f]{7} — waiting for checks/
    );
    const head = repo.refs.get('refs/heads/feature')!;
    // A normal outcome the page shows as such: which gate, and the head landing pushed.
    expect(body.reason).toBe('checks');
    expect(body.rebased).toBe(head);
    expect(repo.refs.get('refs/heads/main')).not.toBe(head);
    expect(
      await t.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM workflow_runs WHERE event = 'pull_request' AND head_sha = ? AND status != 'completed'"
      )
        .bind(head)
        .first()
    ).toEqual({ n: 1 });
    await passChecks();
    expect((await merge()).status).toBe(200);
    expect(repo.refs.get('refs/heads/main')).toBe(head);
  });

  it('指出拒绝合入的门禁；未变基时不返回变基后的分支头', async () => {
    const { merge } = await landing({ ci: true });
    const res = await merge();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason?: string; rebased?: string };
    expect(body.reason).toBe('checks');
    expect(body.rebased).toBeUndefined();
  });

  it('拒绝变基冲突，指出冲突提交，并交由变基运行处理', async () => {
    const { t, repo, base, f2, merge, moveMain } = await landing();
    await moveMain({ ...base, 'c.txt': 'main c\n' });
    const res = await merge();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(
      `stops at commit ${f2.slice(0, 7)}, which conflicts in c.txt. CloudForge is resolving it`
    );
    expect(repo.refs.get('refs/heads/feature')).toBe(f2);
    await settle(t);
    expect(
      t.actions.resolutions.some(
        (r) => (r.params as { rebase?: unknown }).rebase
      )
    ).toBe(true);
  });

  it('没有可合入内容时拒绝合入', async () => {
    const { repo, f2, merge } = await landing();
    repo.refs.set('refs/heads/main', f2);
    const res = await merge();
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Nothing to merge');
  });

  it('对引入变基合入前已合入的拉取请求保留压缩合并规则', async () => {
    const { t, admin, repo, f2 } = await landing();
    const squash = await commitPaths(
      repo,
      'main',
      { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' },
      'B and c (#1)'
    );
    repo.refs.set('refs/pull/1/head', f2);
    await t.env.DB.prepare(
      "UPDATE pull_requests SET state = 'merged', merge_commit_sha = ?, landed_commits = NULL, merged_at = 1, closed_at = 1"
    )
      .bind(squash)
      .run();
    const files = (await (
      await call(t, '/api/repos/octocat/app/pulls/1/files', { cookie: admin })
    ).json()) as { path: string }[];
    expect(files.map((f) => f.path)).toEqual(['b.txt', 'c.txt']);
  });

  it('不为合入而改写其他打开拉取请求共享的分支头', async () => {
    const { t, admin, repo, root, f2, merge, moveMain } = await landing();
    repo.refs.set('refs/heads/release', root);
    const other = await call(t, '/api/repos/octocat/app/pulls', {
      cookie: admin,
      json: { title: 'Backport', body: '', base: 'release', head: 'feature' },
    });
    expect(other.status).toBe(201);
    await settle(t);
    const tip = await moveMain();
    const res = await merge();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(
      'feature is the head of another open pull request (#2)'
    );
    expect(repo.refs.get('refs/heads/feature')).toBe(f2);
    expect(repo.refs.get('refs/heads/main')).toBe(tip);
  });

  it('按第一父提交日志，将合入分支计作一个合入提交', async () => {
    const { t, admin, repo, base, root, f2, merge } = await landing();
    const side = await commitFiles(
      repo,
      'side',
      { ...base, 's.txt': 's\n' },
      'Add s',
      [root]
    );
    const head = await commitFiles(
      repo,
      'feature',
      { ...base, 'b.txt': 'b\n', 'c.txt': 'c\n', 's.txt': 's\n' },
      'Merge side',
      [f2, side]
    );
    expect((await merge()).status).toBe(200);
    expect(repo.refs.get('refs/heads/main')).toBe(head);
    expect(await row(t)).toEqual({ state: 'merged', sha: head, landed: 3 });
    const files = (await (
      await call(t, '/api/repos/octocat/app/pulls/1/files', { cookie: admin })
    ).json()) as { path: string }[];
    expect(files.map((f) => f.path)).toEqual(['b.txt', 'c.txt', 's.txt']);
  });
});

describe('变基后分支头的 Actions 检查', () => {
  it('变基运行在其他操作可能失败前先排队检查，避免未经测试的分支头被合入', async () => {
    const { t, repo, root, f2, merge, moveMain, passChecks } = await landing({
      ci: true,
    });
    await passChecks();
    await moveMain();
    await failingRebasedEvents(t, async () => {
      await moved(t, 'main', root);
      await expect(runRebases(t)).rejects.toThrow();
    });
    const head = repo.refs.get('refs/heads/feature')!;
    expect(head).not.toBe(f2);
    expect(await pendingRuns(t, head)).toEqual({ n: 1 });
    const res = await merge();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason?: string }).reason).toBe('checks');
    expect(repo.refs.get('refs/heads/main')).not.toBe(head);
    await passChecks();
    expect((await merge()).status).toBe(200);
    expect(repo.refs.get('refs/heads/main')).toBe(head);
  });

  it('合入内联变基也先排队检查，其他操作失败时仍等待检查', async () => {
    const { t, repo, f2, merge, moveMain, passChecks } = await landing({
      ci: true,
    });
    await passChecks();
    await moveMain();
    let res!: Response;
    await failingRebasedEvents(t, async () => {
      res = await merge();
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason?: string; rebased?: string };
    const head = repo.refs.get('refs/heads/feature')!;
    expect(head).not.toBe(f2);
    expect(body).toMatchObject({ reason: 'checks', rebased: head });
    expect(await pendingRuns(t, head)).toEqual({ n: 1 });
    await passChecks();
    expect((await merge()).status).toBe(200);
    expect(repo.refs.get('refs/heads/main')).toBe(head);
  });
});

describe('合入期间目标再次移动时的变基', () => {
  it('在“Base branch was modified”拒绝信息中说明分支已变基，并给出新分支头', async () => {
    const { repo, base, f2, merge, moveMain } = await landing();
    await moveMain();
    // Main moves once more right after landing pushes the rebased branch, before it fast-forwards main.
    const push = repo.receivePack.bind(repo);
    let again = false;
    repo.receivePack = async (body) => {
      const out = await push(body);
      if (!again && repo.refs.get('refs/heads/feature') !== f2) {
        again = true;
        await commitPaths(
          repo,
          'main',
          { ...base, 'z.txt': 'z\n', 'y.txt': 'y\n' },
          'Main moves again'
        );
      }
      return out;
    };
    const res = await merge();
    expect(res.status).toBe(409);
    const head = repo.refs.get('refs/heads/feature')!;
    expect(head).not.toBe(f2);
    expect(await res.json()).toMatchObject({
      error: 'Base branch was modified. Review and try the merge again.',
      rebased: head,
    });
  });
});
