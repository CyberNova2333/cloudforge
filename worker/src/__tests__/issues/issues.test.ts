import { describe, expect, it } from 'vitest';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from '../helpers/app';
import { commitFiles } from '../helpers/seed';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { schema } from '../../db/schema';
import { pullRequests } from '../../db/app.schema';
import { closeLinkedIssues } from '../../issues/links';

const base = '/api/repos/octocat/app';

async function withRepo(visibility: 'internal' | 'public' = 'internal') {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const res = await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', addReadme: true, visibility },
  });
  expect(res.status).toBe(201);
  const repo = [...t.fake.repos.values()][0];
  return { t, admin, repo };
}

type IssueOut = {
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  labels: { name: string }[];
  assignees: { username: string }[];
  closedBy: { username: string } | null;
  closedByPull: number | null;
  commentCount: number;
};

async function open(
  t: TestEnv,
  cookie: string,
  json: Record<string, unknown>
): Promise<IssueOut> {
  const res = await call(t, `${base}/issues`, { cookie, json });
  expect(res.status).toBe(201);
  return (await res.json()) as IssueOut;
}

const patch = (t: TestEnv, cookie: string, n: number, json: unknown) =>
  call(t, `${base}/issues/${n}`, { cookie, method: 'PATCH', json });

async function detail(t: TestEnv, cookie: string | undefined, n: number) {
  const res = await call(t, `${base}/issues/${n}`, { cookie });
  return {
    status: res.status,
    body: (await res.json()) as {
      issue: IssueOut;
      events: { kind: string; data: Record<string, unknown> }[];
      comments: { id: string; body: string }[];
      pulls: { number: number; closes: boolean; state: string }[];
      pullNumber?: number;
    },
  };
}

async function label(t: TestEnv, cookie: string, name: string) {
  const res = await call(t, `${base}/labels`, {
    cookie,
    json: { name, color: '#D73A4A' },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; color: string };
}

describe('议题', () => {
  it('与拉取请求共用编号；编号属于拉取请求时 404 并指向它', async () => {
    const { t, admin, repo } = await withRepo();
    expect((await open(t, admin, { title: 'Bug' })).number).toBe(1);
    await commitFiles(repo, 'feature', { 'a.txt': 'a' }, 'feat', [
      repo.refs.get('refs/heads/main')!,
    ]);
    const pr = await call(t, `${base}/pulls`, {
      cookie: admin,
      json: { title: 'Fix', base: 'main', head: 'feature' },
    });
    expect(((await pr.json()) as { number: number }).number).toBe(2);
    expect((await open(t, admin, { title: 'Next' })).number).toBe(3);
    const two = await detail(t, admin, 2);
    expect(two.status).toBe(404);
    expect(two.body.pullNumber).toBe(2);
    expect((await detail(t, admin, 9)).body.pullNumber).toBeUndefined();
  });

  it('能读仓库的成员可以新建和评论，但只有作者或有推送权限的人能关闭', async () => {
    const { t, admin } = await withRepo();
    const bob = await addMember(t, admin, 'bob');
    const carol = await addMember(t, admin, 'carol');
    const mine = await open(t, bob, { title: 'Crash on start', body: 'x' });
    expect(
      (
        await call(t, `${base}/issues/${mine.number}/comments`, {
          cookie: carol,
          json: { body: 'Same here' },
        })
      ).status
    ).toBe(201);
    // Not her issue, no push access.
    expect(
      (await patch(t, carol, mine.number, { state: 'closed' })).status
    ).toBe(403);
    expect(
      (await patch(t, carol, mine.number, { title: 'Renamed' })).status
    ).toBe(403);
    // Its author may.
    const closed = await patch(t, bob, mine.number, {
      state: 'closed',
      stateReason: 'not_planned',
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({
      state: 'closed',
      stateReason: 'not_planned',
      closedBy: { username: 'bob' },
      commentCount: 1,
    });
    // A writer reopens it; the timeline has both.
    expect((await patch(t, admin, mine.number, { state: 'open' })).status).toBe(
      200
    );
    const d = await detail(t, admin, mine.number);
    expect(d.body.issue).toMatchObject({ state: 'open', stateReason: null });
    expect(d.body.events.map((e) => e.kind)).toEqual(['closed', 'reopened']);
    // Closing twice records once.
    await patch(t, admin, mine.number, { state: 'closed' });
    await patch(t, admin, mine.number, { state: 'closed' });
    expect(
      (await detail(t, admin, mine.number)).body.events.map((e) => e.kind)
    ).toEqual(['closed', 'reopened', 'closed']);
  });

  it('标签与指派需要推送权限，指派人必须能推送，改动记入时间线', async () => {
    const { t, admin } = await withRepo();
    const bob = await addMember(t, admin, 'bob');
    const bug = await label(t, admin, 'bug');
    expect(bug.color).toBe('d73a4a');
    await label(t, admin, 'docs');
    // A name differing only in case is taken.
    expect(
      (
        await call(t, `${base}/labels`, {
          cookie: admin,
          json: { name: 'BUG', color: '000000' },
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(t, `${base}/labels`, {
          cookie: bob,
          json: { name: 'x', color: '000000' },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(t, `${base}/issues`, {
          cookie: bob,
          json: { title: 'Mine', labels: ['bug'] },
        })
      ).status
    ).toBe(403);

    const issue = await open(t, admin, { title: 'One', labels: ['Bug'] });
    expect(issue.labels.map((l) => l.name)).toEqual(['bug']);
    expect(
      (await patch(t, admin, issue.number, { labels: ['nope'] })).status
    ).toBe(422);
    // Bob has no push access: he can't be assigned until he collaborates.
    const refused = await patch(t, admin, issue.number, { assignees: ['bob'] });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain(
      '@bob'
    );
    await call(t, `${base}/collaborators/bob`, {
      cookie: admin,
      method: 'PUT',
    });
    const set = await patch(t, admin, issue.number, {
      labels: ['docs'],
      assignees: ['bob', 'octocat'],
    });
    expect(set.status).toBe(200);
    const after = (await set.json()) as IssueOut;
    expect(after.labels.map((l) => l.name)).toEqual(['docs']);
    expect(after.assignees.map((u) => u.username).sort()).toEqual([
      'bob',
      'octocat',
    ]);
    const events = (await detail(t, admin, issue.number)).body.events;
    expect(events.map((e) => [e.kind, e.data.label ?? null]).sort()).toEqual(
      [
        ['assigned', null],
        ['assigned', null],
        ['labeled', 'docs'],
        ['unlabeled', 'bug'],
      ].sort()
    );
    // Deleting a label takes it off its issues; the audit log keeps it.
    const labels = (await (
      await call(t, `${base}/labels`, { cookie: admin })
    ).json()) as { id: string; name: string; openIssues: number }[];
    expect(labels.map((l) => [l.name, l.openIssues])).toEqual([
      ['bug', 0],
      ['docs', 1],
    ]);
    const docs = labels.find((l) => l.name === 'docs')!;
    expect(
      (
        await call(t, `${base}/labels/${docs.id}`, {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    expect((await detail(t, admin, issue.number)).body.issue.labels).toEqual(
      []
    );
    const audit = await t.env.DB.prepare(
      "SELECT action FROM audit_events WHERE action LIKE 'label.%' ORDER BY created_at"
    ).all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual([
      'label.created',
      'label.created',
      'label.deleted',
    ]);
  });

  it('列表按状态、标签、指派人、作者与搜索筛选并分页', async () => {
    const { t, admin } = await withRepo();
    const bob = await addMember(t, admin, 'bob');
    await label(t, admin, 'bug');
    await open(t, admin, { title: 'Login fails', labels: ['bug'] });
    await open(t, bob, { title: 'Dark mode' });
    const third = await open(t, admin, {
      title: 'Login slow',
      assignees: ['octocat'],
    });
    await patch(t, admin, third.number, { state: 'closed' });
    await call(t, `${base}/issues/1/comments`, {
      cookie: bob,
      json: { body: 'Me too' },
    });
    const list = async (q: string) =>
      (await (
        await call(t, `${base}/issues?${q}`, { cookie: admin })
      ).json()) as {
        issues: IssueOut[];
        openCount: number;
        closedCount: number;
        total: number;
      };
    const opened = await list('');
    expect(opened.issues.map((i) => [i.number, i.commentCount])).toEqual([
      [2, 0],
      [1, 1],
    ]);
    expect([opened.openCount, opened.closedCount, opened.total]).toEqual([
      2, 1, 2,
    ]);
    expect(
      (await list('state=all&q=login')).issues.map((i) => i.number)
    ).toEqual([3, 1]);
    expect(
      (await list('state=all&q=%233')).issues.map((i) => i.number)
    ).toEqual([3]);
    expect((await list('label=BUG')).issues.map((i) => i.number)).toEqual([1]);
    expect(
      (await list('state=all&assignee=octocat')).issues.map((i) => i.number)
    ).toEqual([3]);
    expect(
      (await list('state=all&assignee=none')).issues.map((i) => i.number)
    ).toEqual([2, 1]);
    expect((await list('author=bob')).issues.map((i) => i.number)).toEqual([2]);
    expect((await list('author=nobody')).issues).toEqual([]);
    const page = await list('state=all&limit=2&page=2');
    expect([page.issues.map((i) => i.number), page.total]).toEqual([[1], 3]);
  });

  it('public 仓库的访客只能读；仓库关闭议题后接口 404', async () => {
    const { t, admin } = await withRepo('public');
    await open(t, admin, { title: 'Public bug' });
    expect((await call(t, `${base}/issues`)).status).toBe(200);
    expect((await detail(t, undefined, 1)).status).toBe(200);
    expect(
      (await call(t, `${base}/issues`, { json: { title: 'anon' } })).status
    ).toBe(401);

    const repo = async () =>
      (await (await call(t, base, { cookie: admin })).json()) as {
        hasIssues: boolean;
        openIssueCount: number;
      };
    expect(await repo()).toMatchObject({ hasIssues: true, openIssueCount: 1 });
    expect(
      (
        await call(t, base, {
          cookie: admin,
          method: 'PATCH',
          json: { hasIssues: false },
        })
      ).status
    ).toBe(200);
    expect(await repo()).toMatchObject({ hasIssues: false, openIssueCount: 0 });
    expect((await call(t, `${base}/issues`, { cookie: admin })).status).toBe(
      404
    );
    expect((await call(t, `${base}/labels`, { cookie: admin })).status).toBe(
      404
    );
    // Turned back on, the issue is still there.
    await call(t, base, {
      cookie: admin,
      method: 'PATCH',
      json: { hasIssues: true },
    });
    expect((await detail(t, admin, 1)).status).toBe(200);
  });

  it('只有仓库管理员能删除议题，编号不再分配；删别人的评论记审计', async () => {
    const { t, admin } = await withRepo();
    const bob = await addMember(t, admin, 'bob');
    const issue = await open(t, bob, { title: 'Spam' });
    const comment = (await (
      await call(t, `${base}/issues/${issue.number}/comments`, {
        cookie: bob,
        json: { body: 'buy now' },
      })
    ).json()) as { id: string };
    const commentUrl = `${base}/issues/${issue.number}/comments/${comment.id}`;
    // The author edits their own comment.
    expect(
      (
        await call(t, commentUrl, {
          cookie: bob,
          method: 'PATCH',
          json: { body: 'edited' },
        })
      ).status
    ).toBe(200);
    expect(
      (await call(t, commentUrl, { cookie: admin, method: 'DELETE' })).status
    ).toBe(200);
    expect(
      (
        await call(t, `${base}/issues/${issue.number}`, {
          cookie: bob,
          method: 'DELETE',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(t, `${base}/issues/${issue.number}`, {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    expect((await detail(t, admin, issue.number)).status).toBe(404);
    expect((await open(t, admin, { title: 'After' })).number).toBe(2);
    const audit = await t.env.DB.prepare(
      "SELECT action, target FROM audit_events WHERE action LIKE 'issue.%' ORDER BY created_at"
    ).all<{ action: string; target: string }>();
    expect(audit.results).toEqual([
      { action: 'issue.comment_deleted', target: '#1' },
      { action: 'issue.deleted', target: '#1' },
    ]);
  });

  it('拉取请求写 Fixes #N 时关联议题，合并进默认分支后关闭它', async () => {
    const { t, admin, repo } = await withRepo();
    const fixed = await open(t, admin, { title: 'Broken' });
    const mentioned = await open(t, admin, { title: 'Related' });
    await commitFiles(repo, 'feature', { 'a.txt': 'a' }, 'feat', [
      repo.refs.get('refs/heads/main')!,
    ]);
    const pr = await call(t, `${base}/pulls`, {
      cookie: admin,
      json: {
        title: 'Repair',
        body: `Fixes #${fixed.number}, see #${mentioned.number}. \`#99\``,
        base: 'main',
        head: 'feature',
      },
    });
    const prNumber = ((await pr.json()) as { number: number }).number;
    const linked = await detail(t, admin, fixed.number);
    expect(linked.body.pulls).toEqual([
      { number: prNumber, title: 'Repair', state: 'open', closes: true },
    ]);
    expect(linked.body.events.map((e) => [e.kind, e.data])).toEqual([
      ['referenced', { pull: prNumber, closes: true }],
    ]);
    const prDetail = (await (
      await call(t, `${base}/pulls/${prNumber}`, { cookie: admin })
    ).json()) as { issues: { number: number; closes: boolean }[] };
    expect(prDetail.issues.map((i) => [i.number, i.closes])).toEqual([
      [fixed.number, true],
      [mentioned.number, false],
    ]);
    // Editing the description again records no second reference.
    await call(t, `${base}/pulls/${prNumber}`, {
      cookie: admin,
      method: 'PATCH',
      json: { body: `Closes #${fixed.number}` },
    });
    expect((await detail(t, admin, mentioned.number)).body.pulls).toEqual([]);
    expect(
      (await detail(t, admin, fixed.number)).body.events.map((e) => e.kind)
    ).toEqual(['referenced']);

    const merge = await call(t, `${base}/pulls/${prNumber}/merge`, {
      cookie: admin,
      json: { approve: true },
    });
    expect(merge.status).toBe(200);
    await settle(t);
    const closed = await detail(t, admin, fixed.number);
    expect(closed.body.issue).toMatchObject({
      state: 'closed',
      stateReason: 'completed',
      closedByPull: prNumber,
      closedBy: { username: 'octocat' },
    });
    expect(closed.body.events.at(-1)).toMatchObject({
      kind: 'closed',
      data: { reason: 'completed', pull: prNumber },
    });
    expect(closed.body.pulls[0].state).toBe('merged');
    // The landing step runs again on recovery: nothing changes the second time.
    const db = drizzle(t.env.DB, { schema });
    const row = (await db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.number, prNumber))
      .get())!;
    expect(await closeLinkedIssues(db, row, null)).toBe(0);
    expect(
      (await detail(t, admin, fixed.number)).body.events.map((e) => e.kind)
    ).toEqual(['referenced', 'closed']);
    expect((await detail(t, admin, mentioned.number)).body.issue.state).toBe(
      'open'
    );
  });

  it('合并进其他分支不关闭议题', async () => {
    const { t, admin, repo } = await withRepo();
    const issue = await open(t, admin, { title: 'Later' });
    const dev = await commitFiles(repo, 'develop', { 'b.txt': 'b' }, 'dev', [
      repo.refs.get('refs/heads/main')!,
    ]);
    await commitFiles(repo, 'topic', { 'b.txt': 'b', 'c.txt': 'c' }, 'topic', [
      dev,
    ]);
    const pr = await call(t, `${base}/pulls`, {
      cookie: admin,
      json: {
        title: `Fix #${issue.number}`,
        body: `fixes #${issue.number}`,
        base: 'develop',
        head: 'topic',
      },
    });
    const prNumber = ((await pr.json()) as { number: number }).number;
    expect(
      (
        await call(t, `${base}/pulls/${prNumber}/merge`, {
          cookie: admin,
          json: { approve: true },
        })
      ).status
    ).toBe(200);
    await settle(t);
    expect((await detail(t, admin, issue.number)).body.issue.state).toBe(
      'open'
    );
  });
});
