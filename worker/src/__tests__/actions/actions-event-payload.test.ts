// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/schema';
import {
  pullRequests,
  workflowRuns,
  type WorkflowRun,
} from '../../db/app.schema';
import { findRepoById, gitFor } from '../../repositories/service';
import {
  eventPayload,
  MAX_EVENT_BYTES,
  type EventSource,
} from '../../actions/event-payload';
import { rerun } from '../../actions/trigger';
import { CI, pushFiles, runs, setup, type Setup } from '../helpers/actions';
import { call, settle } from '../helpers/app';
import { commitPaths } from '../helpers/seed';

async function source(s: Setup, run: WorkflowRun): Promise<EventSource> {
  const db = drizzle(s.t.env.DB, { schema });
  const found = (await findRepoById(db, run.repositoryId))!;
  return {
    event: run.event,
    ref: run.ref,
    headSha: run.headSha,
    data: run.eventData,
    serverUrl: 'http://test.local',
    repo: found.repo,
    owner: found.namespace,
    // Include the full DB object deliberately: the payload serializer must whitelist public fields.
    sender: { ...found.owner, username: found.owner.username! },
  };
}

async function latest(s: Setup) {
  const db = drizzle(s.t.env.DB, { schema });
  const [run] = (await runs(s.t, s.admin)).runs;
  return (await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, run.id))
    .get())!;
}

describe('Actions GitHub 事件负载', () => {
  it('从真实推送记录 before/after 和固定提交的文件变化，不暴露账户邮箱', async () => {
    const s = await setup();
    const before = s.repo.refs.get('refs/heads/main')!;
    const after = await pushFiles(
      s,
      'main',
      {
        '.github/workflows/ci.yml': CI,
        'added.txt': 'new',
      },
      'Push payload'
    );
    const run = await latest(s);
    expect(run.eventData).toEqual({ before });
    const src = await source(s, run);
    const db = drizzle(s.t.env.DB, { schema });
    const found = (await findRepoById(db, run.repositoryId))!;
    const payload = await eventPayload(gitFor(s.t.env, found.repo), src);
    expect(payload).toMatchObject({
      ref: 'refs/heads/main',
      before,
      after,
      created: false,
      forced: false,
      repository: {
        full_name: 'octocat/app',
        private: true,
        visibility: 'internal',
      },
      sender: { login: 'octocat' },
      pusher: { name: 'octocat' },
      head_commit: {
        id: after,
        message: 'Push payload',
        added: expect.arrayContaining(['added.txt']),
      },
    });
    expect(payload.sender).not.toHaveProperty('email');
    expect(payload.pusher).not.toHaveProperty('email');
    expect(JSON.stringify(payload)).not.toContain(found.owner.email);
    expect(payload.head_commit).toMatchObject({
      author: { email: 'dev@example.com' },
    });
  });

  it('PR 运行和重跑使用入队时的正文、作者、状态和 base SHA', async () => {
    const s = await setup();
    const base = await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    s.repo.refs.set('refs/heads/feature', base);
    const head = await pushFiles(s, 'feature', {
      '.github/workflows/ci.yml': CI,
      'feature.txt': 'feature',
    });
    const opened = await call(s.t, '/api/repos/octocat/app/pulls', {
      cookie: s.admin,
      json: {
        title: 'Original title',
        body: 'Original body',
        base: 'main',
        head: 'feature',
      },
    });
    expect(opened.status).toBe(201);
    await settle(s.t);
    const run = await latest(s);
    const db = drizzle(s.t.env.DB, { schema });
    const found = (await findRepoById(db, run.repositoryId))!;
    expect(run.eventData).toMatchObject({
      title: 'Original title',
      baseSha: base,
      pull: {
        body: 'Original body',
        state: 'open',
        author: { username: 'octocat' },
      },
    });
    await db
      .update(pullRequests)
      .set({ title: 'Later title', body: 'Later body', state: 'closed' })
      .where(eq(pullRequests.repositoryId, found.repo.id));
    await commitPaths(s.repo, 'main', { 'later.txt': 'later' }, 'Later base');
    const git = gitFor(s.t.env, found.repo);
    const payload = await eventPayload(git, await source(s, run));
    expect(payload).toMatchObject({
      number: 1,
      pull_request: {
        title: 'Original title',
        body: 'Original body',
        state: 'open',
        user: { login: 'octocat' },
        head: { ref: 'feature', sha: head },
        base: { ref: 'main', sha: base },
      },
    });
    const id = await rerun(
      s.t.env,
      db,
      found.repo,
      'octocat/app',
      run,
      found.owner.id
    );
    const again = (await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, id))
      .get())!;
    expect(again.eventData).toEqual(run.eventData);
    const replay = await eventPayload(git, await source(s, again));
    expect(replay.pull_request).toEqual(payload.pull_request);
  });

  it('同步推送记录 synchronize，并且不同工作流共享同一份事件事实', async () => {
    const s = await setup();
    const base = await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    s.repo.refs.set('refs/heads/feature', base);
    await pushFiles(s, 'feature', { '.github/workflows/ci.yml': CI, a: 'one' });
    await call(s.t, '/api/repos/octocat/app/pulls', {
      cookie: s.admin,
      json: { title: 'Feature', base: 'main', head: 'feature' },
    });
    await settle(s.t);
    const head = await pushFiles(s, 'feature', {
      '.github/workflows/ci.yml': CI,
      '.github/workflows/second.yml': CI,
      a: 'two',
    });
    const db = drizzle(s.t.env.DB, { schema });
    const matched = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.headSha, head));
    expect(matched).toHaveLength(2);
    expect(matched[0].eventData).toMatchObject({
      action: 'synchronize',
      baseSha: base,
    });
    expect(matched[1].eventData).toEqual(matched[0].eventData);
  });

  it('旧 PR 行的未知 action/body/base SHA 不从当前可变记录补造', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const run = await latest(s);
    const src = await source(s, run);
    const found = (await findRepoById(
      drizzle(s.t.env.DB, { schema }),
      run.repositoryId
    ))!;
    const payload = await eventPayload(gitFor(s.t.env, found.repo), {
      ...src,
      event: 'pull_request',
      data: {
        number: 7,
        title: 'Legacy',
        baseRef: 'main',
        headRef: 'old-feature',
      },
    });
    expect(payload).toMatchObject({
      action: null,
      number: 7,
      pull_request: {
        title: 'Legacy',
        body: null,
        state: null,
        user: null,
        base: { ref: 'main', sha: null },
      },
    });
  });

  it('旧 push 行没有 before 时不冒充新分支或断言非强推', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const run = await latest(s);
    const src = await source(s, run);
    const found = (await findRepoById(
      drizzle(s.t.env.DB, { schema }),
      run.repositoryId
    ))!;
    const payload = await eventPayload(gitFor(s.t.env, found.repo), {
      ...src,
      data: null,
    });
    expect(payload).toMatchObject({
      before: null,
      created: null,
      forced: null,
      compare: null,
      commits: [],
    });
    expect(payload.head_commit).toMatchObject({ id: run.headSha });
  });

  it('提交列表最多保留 20 项，并且不读取后续分支 head', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const run = await latest(s);
    let head = run.headSha;
    for (let i = 0; i < 23; i++)
      head = await commitPaths(s.repo, 'main', { a: String(i) }, `Commit ${i}`);
    const src = await source(s, run);
    const found = (await findRepoById(
      drizzle(s.t.env.DB, { schema }),
      run.repositoryId
    ))!;
    const payload = await eventPayload(gitFor(s.t.env, found.repo), {
      ...src,
      headSha: head,
      data: { before: run.headSha },
    });
    expect(payload.commits).toHaveLength(20);
    expect(payload.head_commit).toMatchObject({
      id: head,
      message: 'Commit 22',
    });
    await commitPaths(s.repo, 'main', { a: 'later' }, 'Later');
    const again = await eventPayload(gitFor(s.t.env, found.repo), {
      ...src,
      headSha: head,
      data: { before: run.headSha },
    });
    expect(again).toEqual(payload);
  });

  it('缺失父提交对象时不把非根提交的所有文件冒充新增文件', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': CI,
      existing: 'old',
    });
    const run = await latest(s);
    const src = await source(s, run);
    const found = (await findRepoById(
      drizzle(s.t.env.DB, { schema }),
      run.repositoryId
    ))!;
    const parent = s.repo.parseCommit(run.headSha)!.parents[0];
    s.repo.objects.delete(parent);
    const payload = await eventPayload(gitFor(s.t.env, found.repo), {
      ...src,
      data: { before: '0'.repeat(40) },
    });
    expect(payload.head_commit).toMatchObject({ id: run.headSha });
    expect(payload.head_commit).not.toHaveProperty('added');
    expect(payload.head_commit).not.toHaveProperty('removed');
    expect(payload.head_commit).not.toHaveProperty('modified');
  });

  it('大 PR 正文包含多字节与 JSON 转义字符时仍满足 UTF-8 硬上限', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const run = await latest(s);
    const src = await source(s, run);
    const found = (await findRepoById(
      drizzle(s.t.env.DB, { schema }),
      run.repositoryId
    ))!;
    const payload = await eventPayload(gitFor(s.t.env, found.repo), {
      ...src,
      event: 'pull_request',
      data: {
        number: 1,
        title: 'Large',
        baseRef: 'main',
        headRef: 'feature',
        pull: {
          id: 'pr',
          body: '\u0001🚀'.repeat(60_000),
          state: 'open',
          createdAt: 1_700_000_000_000,
          author: null,
        },
      },
    });
    expect(
      new TextEncoder().encode(JSON.stringify(payload)).length
    ).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    expect(payload.pull_request).toMatchObject({ number: 1, title: 'Large' });
  });
});
