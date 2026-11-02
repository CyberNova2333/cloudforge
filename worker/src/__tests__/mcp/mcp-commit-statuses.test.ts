import { expect, it } from 'vitest';
import { addMember, call, settle } from '../helpers/app';
import { connect, crewRepo, tool } from '../helpers/crew';

const repository = 'octocat/app';
const parse = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0].text);

it('默认分支名称恰为已有提交 SHA 时仍读取分支真正的 tip 和文件', async () => {
  const s = await crewRepo();
  const branchName = s.main;
  const tip = await s.branch(branchName, {
    'deploy-marker.txt': 'current default branch',
  });
  await s.setRepo('default_branch', branchName);
  const { access_token } = await connect(s.t, s.admin);
  await tool(s.t, access_token, 'cloudforge_create_commit_status', {
    repository,
    sha: tip,
    state: 'failure',
    context: 'deploy',
  });
  const result = await tool(s.t, access_token, 'cloudforge_get_commit_status', {
    repository,
  });
  expect(result.isError).toBeUndefined();
  expect(parse(result)).toMatchObject({
    sha: tip,
    state: 'failure',
    total_count: 1,
  });
  const search = await call(
    s.t,
    '/api/search?q=deploy-marker&repo=octocat%2Fapp',
    { cookie: s.admin }
  );
  expect(search.status).toBe(200);
  expect(await search.json()).toMatchObject({
    files: [{ repo: repository, path: 'deploy-marker.txt' }],
  });
});

it('reports and reads external status through OAuth MCP and enforces the merge gate', async () => {
  const s = await crewRepo();
  const head = await s.branch('feature');
  const number = await s.web('feature');
  const { access_token } = await connect(s.t, s.admin);
  expect(
    parse(
      await tool(s.t, access_token, 'cloudforge_get_commit_status', {
        repository,
      })
    )
  ).toMatchObject({
    state: null,
    total_count: 0,
    statuses: [],
  });
  const reported = await tool(
    s.t,
    access_token,
    'cloudforge_create_commit_status',
    {
      repository,
      sha: head.toUpperCase(),
      state: 'failure',
      context: ' ci/build ',
      target_url: 'https://ci.example.com/build/1',
      description: 'Build failed',
    }
  );
  expect(reported.isError).toBeUndefined();
  expect(parse(reported)).toMatchObject({
    repository,
    sha: head,
    state: 'failure',
    context: 'ci/build',
    creator: { login: 'octocat' },
  });
  expect(
    parse(
      await tool(s.t, access_token, 'cloudforge_get_commit_status', {
        repository,
        ref: 'feature',
      })
    )
  ).toMatchObject({
    sha: head,
    state: 'failure',
    total_count: 1,
    statuses: [
      {
        context: 'ci/build',
        state: 'failure',
        target_url: 'https://ci.example.com/build/1',
      },
    ],
  });
  const merge = () =>
    call(s.t, `/api/repos/${repository}/pulls/${number}/merge`, {
      cookie: s.admin,
      json: { approve: true },
    });
  expect((await merge()).status).toBe(409);
  expect(
    (
      await tool(s.t, access_token, 'cloudforge_create_commit_status', {
        repository,
        sha: head,
        state: 'success',
        context: 'ci/build',
      })
    ).isError
  ).toBeUndefined();
  await settle(s.t);
  expect(
    parse(
      await tool(s.t, access_token, 'cloudforge_get_commit_status', {
        repository,
        ref: head,
      })
    )
  ).toMatchObject({ state: 'success', total_count: 1 });
  expect((await merge()).status).toBe(200);
});

it('requires push access to report and hides private repositories from other members', async () => {
  const s = await crewRepo();
  const bob = await addMember(s.t, s.admin, 'bob');
  const { access_token } = await connect(s.t, bob);
  const sha = s.repo.refs.get('refs/heads/main')!;
  expect(
    (
      await tool(s.t, access_token, 'cloudforge_get_commit_status', {
        repository,
      })
    ).isError
  ).toBeUndefined();
  const denied = await tool(
    s.t,
    access_token,
    'cloudforge_create_commit_status',
    { repository, sha, state: 'success' }
  );
  expect(denied.isError).toBe(true);
  expect(denied.content[0].text).toContain('push access');
  expect(
    (
      await call(s.t, '/api/repos', {
        cookie: s.admin,
        json: { name: 'hidden', visibility: 'private', addReadme: true },
      })
    ).status
  ).toBe(201);
  for (const name of [
    'cloudforge_get_commit_status',
    'cloudforge_create_commit_status',
  ]) {
    const result = await tool(s.t, access_token, name, {
      repository: 'octocat/hidden',
      sha,
      state: 'success',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No repository named');
  }
  expect(
    await s.t.env.DB.prepare('SELECT COUNT(*) AS n FROM commit_statuses').first(
      'n'
    )
  ).toBe(0);
});

it('validates MCP status fields like REST and rejects unknown commits and refs', async () => {
  const s = await crewRepo();
  const { access_token } = await connect(s.t, s.admin);
  const sha = s.repo.refs.get('refs/heads/main')!;
  for (const fields of [
    { state: 'passed' },
    { state: true },
    { sha: 'abc' },
    { sha: 'f'.repeat(40) },
    { context: '' },
    { context: 'x'.repeat(101) },
    { context: 1 },
    { description: 'x'.repeat(141) },
    { target_url: 'javascript:alert(1)' },
    { target_url: false },
  ]) {
    const result = await tool(
      s.t,
      access_token,
      'cloudforge_create_commit_status',
      {
        repository,
        sha,
        state: 'success',
        ...fields,
      }
    );
    expect(result.isError, JSON.stringify(fields)).toBe(true);
  }
  for (const ref of ['unknown', 'f'.repeat(40), '', 'x'.repeat(256)])
    expect(
      (
        await tool(s.t, access_token, 'cloudforge_get_commit_status', {
          repository,
          ref,
        })
      ).isError
    ).toBe(true);
  expect(
    await s.t.env.DB.prepare('SELECT COUNT(*) AS n FROM commit_statuses').first(
      'n'
    )
  ).toBe(0);
});
