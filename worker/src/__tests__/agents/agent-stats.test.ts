// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { addMember, call } from '../helpers/app';
import { newAgent } from '../helpers/agents';
import { appRepo, invitedAgent } from '../helpers/reviews';

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
/** Seconds since the epoch, `days` days ago. */
const ago = (days: number) => now() - Math.round(days * DAY);
/** Midday UTC, `days` UTC days ago. */
const middayAgo = (days: number) =>
  Math.floor(now() / DAY) * DAY - days * DAY + 12 * 3600;
const utcDate = (days: number) =>
  new Date(middayAgo(days) * 1000).toISOString().slice(0, 10);

type AgentStats = {
  handle: string;
  raised: number;
  kept: number;
  dismissed: number;
  keptPct: number | null;
  rules: number;
  reviews: number;
  byDay: { date: string; reviews: number }[];
  bestCatch: { title: string; repo: string; number: number } | null;
  repos: { repo: string; status: string; number: number | null }[];
};

type Builtin = {
  id: 'clef' | 'fixer';
  name: string;
  job: string;
  stats: { label: string; value: string }[];
};

/**
 * octocat/app (internal) and octocat/secret (private), written straight into D1:
 *  app:    #1 merged, #2 open, #3 open, #4 closed, #5 merged
 *  secret: #1 open
 * with `secagent` invited to both, and to octocat/quiet, where nothing ever happened.
 */
async function world() {
  const { t, admin } = await appRepo();
  await invitedAgent(t, admin, 'secagent');
  for (const [name, visibility] of [
    ['secret', 'private'],
    ['quiet', 'internal'],
  ])
    await call(t, '/api/repos', { cookie: admin, json: { name, visibility } });
  for (const name of ['secret', 'quiet'])
    expect(
      (
        await call(t, `/api/repos/octocat/${name}/agents/secagent`, {
          cookie: admin,
          method: 'PUT',
        })
      ).status
    ).toBe(200);
  const bob = await addMember(t, admin, 'bob');

  const first = async <T>(sql: string, ...binds: unknown[]) =>
    (await t.env.DB.prepare(sql)
      .bind(...binds)
      .first<T>())!;
  const exec = (sql: string, ...binds: unknown[]) =>
    t.env.DB.prepare(sql)
      .bind(...binds)
      .run();
  const author = (
    await first<{ id: string }>(
      `SELECT id FROM users WHERE username = 'octocat'`
    )
  ).id;
  const repoId = async (name: string) =>
    (
      await first<{ id: string }>(
        'SELECT id FROM repositories WHERE name = ?',
        name
      )
    ).id;
  const app = await repoId('app');
  const secret = await repoId('secret');
  const quiet = await repoId('quiet');
  const agentId = async (handle: string) =>
    (
      await first<{ id: string }>(
        'SELECT id FROM users WHERE username = ?',
        handle
      )
    ).id;

  const pr = (
    repo: string,
    key: string,
    number: number,
    state: 'open' | 'merged' | 'closed',
    mergedAt: number | null = null
  ) =>
    exec(
      `INSERT INTO pull_requests (id, repository_id, number, title, author_id, base_ref, head_ref, state, merged_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'main', ?, ?, ?, ?, ?)`,
      key,
      repo,
      number,
      `PR ${key}`,
      author,
      `b-${key}`,
      state,
      mergedAt,
      ago(12),
      ago(12)
    );
  await pr(app, 'a1', 1, 'merged', ago(1));
  await pr(app, 'a2', 2, 'open');
  await pr(app, 'a3', 3, 'open');
  await pr(app, 'a4', 4, 'closed');
  await pr(app, 'a5', 5, 'merged', ago(2));
  await pr(secret, 's1', 1, 'open');

  const classification = (
    id: string,
    prId: string,
    head: string,
    status: string,
    at: number,
    durationMs: number | null = null
  ) =>
    exec(
      `INSERT INTO pr_classifications (id, pull_request_id, head_sha, status, summary_model, classifier_model, duration_ms, created_at)
       VALUES (?, ?, ?, ?, 'glm', 'clef', ?, ?)`,
      id,
      prId,
      head,
      status,
      durationMs,
      at
    );
  const flag = async (
    id: string,
    classificationId: string,
    agent: string,
    kind: 'needs_person' | 'change_requested',
    opts: { approvedAt?: number; title?: string } = {}
  ) =>
    exec(
      `INSERT INTO pr_review_flags (id, classification_id, key, value, paths, approved_at, agent_id, kind, created_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
      id,
      classificationId,
      `${agent}:${id}`,
      JSON.stringify({ title: opts.title ?? `Finding ${id}` }),
      opts.approvedAt ?? null,
      await agentId(agent),
      kind,
      ago(30)
    );
  const reviewer = async (
    id: string,
    prId: string,
    head: string,
    agent: string,
    status: string,
    at: number
  ) =>
    exec(
      `INSERT INTO pr_reviewers (id, pull_request_id, head_sha, agent_id, requested, status, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      id,
      prId,
      head,
      await agentId(agent),
      status,
      at
    );
  const lesson = async (
    id: string,
    agent: string,
    prId: string,
    repo: string,
    status: string
  ) =>
    exec(
      `INSERT INTO agent_lessons (id, agent_id, pull_request_id, repository_id, finding_ids, status, created_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?)`,
      id,
      await agentId(agent),
      prId,
      repo,
      status,
      ago(5)
    );
  const run = (
    id: string,
    repo: string,
    prId: string | null,
    kind: string,
    status: string,
    startedAt: number
  ) =>
    exec(
      `INSERT INTO agent_runs (id, repository_id, pull_request_id, kind, status, title, workflow_instance_id, started_at)
       VALUES (?, ?, ?, ?, ?, 'x', ?, ?)`,
      id,
      repo,
      prId,
      kind,
      status,
      id,
      startedAt * 1000
    );
  const stats = async (cookie: string, handle = 'secagent') => {
    const res = await call(t, `/api/agents/${handle}/stats`, { cookie });
    expect(res.status).toBe(200);
    return (await res.json()) as AgentStats;
  };
  const builtin = async (cookie: string) => {
    const res = await call(t, '/api/agents/builtin', { cookie });
    expect(res.status).toBe(200);
    return (await res.json()) as Builtin[];
  };
  return {
    t,
    admin,
    bob,
    app,
    secret,
    quiet,
    pr,
    classification,
    flag,
    reviewer,
    lesson,
    run,
    stats,
    builtin,
    exec,
    first,
  };
}

describe('GET /api/agents/{handle}/stats 智能体统计', () => {
  async function seeded() {
    const w = await world();
    await newAgent(w.t, w.admin, 'otheragent', 'Other');
    await newAgent(w.t, w.admin, 'quietagent', 'Quiet');
    await w.classification('a1-h1', 'a1', 'h1', 'done', ago(10));
    await w.classification('a2-h1', 'a2', 'h1', 'done', ago(5));
    await w.classification('a2-h2', 'a2', 'h2', 'done', ago(4));
    await w.classification('a3-h1', 'a3', 'h1', 'done', ago(2));
    await w.classification('s1-h1', 's1', 'h1', 'done', ago(2));
    // kept: a needs_person finding a person approved
    await w.flag('f1', 'a1-h1', 'secagent', 'needs_person', {
      approvedAt: ago(3),
      title: 'Token written to the log',
    });
    // dismissed: a change request a person dismissed
    await w.flag('f2', 'a1-h1', 'secagent', 'change_requested', {
      approvedAt: ago(9),
    });
    // kept: a change request the author fixed (a newer commit was reviewed after it)
    await w.flag('f3', 'a2-h1', 'secagent', 'change_requested');
    // still open: neither kept nor dismissed yet
    await w.flag('f4', 'a2-h2', 'secagent', 'change_requested');
    await w.flag('f5', 'a3-h1', 'secagent', 'needs_person');
    // kept, but older than f1
    await w.flag('f6', 'a1-h1', 'secagent', 'needs_person', {
      approvedAt: ago(20),
      title: 'Older catch',
    });
    // kept, the newest of all, in a private repository
    await w.flag('f7', 's1-h1', 'secagent', 'needs_person', {
      approvedAt: ago(1),
      title: 'Secret catch',
    });
    // another agent's: never counted for secagent
    await w.flag('g1', 'a3-h1', 'otheragent', 'needs_person', {
      approvedAt: ago(1),
    });
    // quietagent: one open finding, nothing decided
    await w.flag('q1', 'a3-h1', 'quietagent', 'needs_person');
    return w;
  }

  it('统计提出的意见，以及被采纳或驳回的数量', async () => {
    const w = await seeded();
    const s = await w.stats(w.admin);
    expect(s).toMatchObject({
      handle: 'secagent',
      raised: 7,
      kept: 4,
      dismissed: 1,
      keptPct: 80,
    });
  });

  it('尚未作出任何决定时，不提供采纳比例', async () => {
    const w = await seeded();
    expect(await w.stats(w.admin, 'quietagent')).toMatchObject({
      raised: 1,
      kept: 0,
      dismissed: 0,
      keptPct: null,
    });
    expect(await w.stats(w.admin, 'otheragent')).toMatchObject({
      raised: 1,
      kept: 1,
      dismissed: 0,
      keptPct: 100,
    });
  });

  it('智能体从未审查时，所有统计均为零或 null', async () => {
    const w = await world();
    expect(await w.stats(w.admin)).toEqual({
      handle: 'secagent',
      raised: 0,
      kept: 0,
      dismissed: 0,
      keptPct: null,
      rules: 0,
      reviews: 0,
      byDay: expect.any(Array),
      bestCatch: null,
      repos: [
        { repo: 'octocat/app', status: 'idle', number: null },
        { repo: 'octocat/quiet', status: 'idle', number: null },
        { repo: 'octocat/secret', status: 'idle', number: null },
      ],
    });
  });

  it('仅从已提交的学习任务中统计学到的规则', async () => {
    const w = await seeded();
    await w.lesson('l1', 'secagent', 'a1', w.app, 'committed');
    await w.lesson('l2', 'secagent', 'a2', w.app, 'committed');
    await w.lesson('l3', 'secagent', 'a3', w.app, 'failed');
    await w.lesson('l4', 'secagent', 'a4', w.app, 'pending');
    await w.lesson('l5', 'secagent', 's1', w.secret, 'committed');
    await w.lesson('l6', 'otheragent', 'a1', w.app, 'committed');
    expect((await w.stats(w.admin)).rules).toBe(3);
    expect((await w.stats(w.bob)).rules).toBe(2);
  });

  it('统计实际执行的审查，不计入无需参与的审查', async () => {
    const w = await seeded();
    await w.reviewer('r1', 'a1', 'h1', 'secagent', 'approved', ago(1));
    await w.reviewer('r2', 'a2', 'h1', 'secagent', 'not_needed', ago(1));
    await w.reviewer('r3', 'a2', 'h2', 'secagent', 'flagged', ago(1));
    await w.reviewer('r4', 'a3', 'h1', 'otheragent', 'approved', ago(1));
    expect((await w.stats(w.admin)).reviews).toBe(2);
  });

  it('按从早到晚列出 182 个 UTC 日期及各日审查', async () => {
    const w = await seeded();
    await w.reviewer('r1', 'a1', 'h1', 'secagent', 'approved', middayAgo(0));
    await w.reviewer('r2', 'a2', 'h1', 'secagent', 'approved', middayAgo(4));
    await w.reviewer('r3', 'a2', 'h2', 'secagent', 'flagged', middayAgo(3));
    await w.reviewer('r4', 'a3', 'h1', 'secagent', 'reviewing', middayAgo(181));
    await w.reviewer('r5', 'a3', 'h2', 'secagent', 'not_needed', middayAgo(0));
    // One day too old to show; still a review it did.
    await w.reviewer('r6', 'a3', 'h3', 'secagent', 'approved', middayAgo(182));
    await w.reviewer('r7', 's1', 'h1', 'secagent', 'flagged', middayAgo(0));
    await w.reviewer('r8', 'a4', 'h1', 'secagent', 'approved', middayAgo(0));

    const s = await w.stats(w.admin);
    expect(s.byDay).toHaveLength(182);
    expect(s.byDay[0]).toEqual({ date: utcDate(181), reviews: 1 });
    expect(s.byDay[181]).toEqual({ date: utcDate(0), reviews: 3 });
    expect(s.byDay[177]).toEqual({ date: utcDate(4), reviews: 1 });
    expect(s.byDay[178]).toEqual({ date: utcDate(3), reviews: 1 });
    // Every day is there once, in order, and the rest are empty.
    const dates = s.byDay.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(182);
    expect(s.byDay.reduce((n, d) => n + d.reviews, 0)).toBe(6);
    expect(s.reviews).toBe(7);

    // The viewer can't see the private repository's review.
    const asBob = await w.stats(w.bob);
    expect(asBob.byDay[181].reviews).toBe(2);
  });

  it('将人工最新批准的审查意见列为最佳发现', async () => {
    const w = await seeded();
    expect((await w.stats(w.admin)).bestCatch).toEqual({
      title: 'Secret catch',
      repo: 'octocat/secret',
      number: 1,
    });
    // Without the private repository the newest one it can show is f1 (f2 is a dismissed change request).
    expect((await w.stats(w.bob)).bestCatch).toEqual({
      title: 'Token written to the log',
      repo: 'octocat/app',
      number: 1,
    });
  });

  it('为没有标题的审查意见提供普通标题', async () => {
    const w = await world();
    await w.classification('a1-h1', 'a1', 'h1', 'done', ago(1));
    await w.exec(
      `INSERT INTO pr_review_flags (id, classification_id, key, value, paths, approved_at, agent_id, kind, created_at)
       VALUES ('x', 'a1-h1', 'k', NULL, '[]', ?, ?, 'needs_person', ?)`,
      ago(1),
      (
        await w.first<{ id: string }>(
          `SELECT id FROM users WHERE username = 'secagent'`
        )
      ).id,
      ago(2)
    );
    expect((await w.stats(w.admin)).bestCatch).toEqual({
      title: 'Finding',
      repo: 'octocat/app',
      number: 1,
    });
  });

  it('显示当前工作位置，以及每个受邀仓库中最紧急的状态', async () => {
    const w = await seeded();
    // app: #2 is flagged (newest row), #3 is being reviewed; flagged is the more pressing
    await w.reviewer('r1', 'a2', 'h1', 'secagent', 'approved', ago(4));
    await w.reviewer('r2', 'a2', 'h2', 'secagent', 'flagged', ago(3));
    await w.reviewer('r3', 'a3', 'h1', 'secagent', 'reviewing', ago(2));
    // a merged pull request is no longer anyone's work
    await w.reviewer('r4', 'a1', 'h1', 'secagent', 'changes_requested', ago(1));
    // secret: reviewing #1
    await w.reviewer('r5', 's1', 'h1', 'secagent', 'reviewing', ago(1));
    expect((await w.stats(w.admin)).repos).toEqual([
      { repo: 'octocat/app', status: 'flagged', number: 2 },
      { repo: 'octocat/quiet', status: 'idle', number: null },
      { repo: 'octocat/secret', status: 'reviewing', number: 1 },
    ]);
    // bob never sees the private repository.
    expect((await w.stats(w.bob)).repos.map((r) => r.repo)).toEqual([
      'octocat/app',
      'octocat/quiet',
    ]);
  });

  it('多个审查紧急程度相同时，指向最新审查', async () => {
    const w = await world();
    await w.reviewer('r1', 'a2', 'h1', 'secagent', 'reviewing', ago(3));
    await w.reviewer('r2', 'a3', 'h1', 'secagent', 'reviewing', ago(1));
    expect((await w.stats(w.admin)).repos[0]).toEqual({
      repo: 'octocat/app',
      status: 'reviewing',
      number: 3,
    });
  });

  it('新提交无需该智能体审查后，不保留旧提交状态', async () => {
    const w = await world();
    const notNeeded = async (id: string, prId: string, at: number) =>
      w.exec(
        `INSERT INTO pr_reviewers (id, pull_request_id, head_sha, agent_id, requested, status, created_at)
         VALUES (?, ?, 'h2', (SELECT id FROM users WHERE username = 'secagent'), 0, 'not_needed', ?)`,
        id,
        prId,
        at
      );
    // #2: flagged at h1, then not needed at h2. #3: reviewing.
    await w.reviewer('r1', 'a2', 'h1', 'secagent', 'flagged', ago(3));
    await w.reviewer('r2', 'a3', 'h1', 'secagent', 'reviewing', ago(2));
    expect((await w.stats(w.admin)).repos[0]).toEqual({
      repo: 'octocat/app',
      status: 'flagged',
      number: 2,
    });
    await notNeeded('r3', 'a2', ago(1));
    expect((await w.stats(w.admin)).repos[0]).toEqual({
      repo: 'octocat/app',
      status: 'reviewing',
      number: 3,
    });
    // Not needed at the newest commit of #3 as well: it is on nothing.
    await notNeeded('r4', 'a3', ago(0.5));
    expect((await w.stats(w.admin)).repos[0]).toEqual({
      repo: 'octocat/app',
      status: 'idle',
      number: null,
    });
    // Those rows are still reviews it did before: the earlier ones count, a not-needed one doesn't.
    expect((await w.stats(w.admin)).reviews).toBe(2);
  });

  it('所有统计均排除查看者无权访问的内容', async () => {
    const w = await seeded();
    expect(await w.stats(w.bob)).toMatchObject({
      raised: 6,
      kept: 3,
      dismissed: 1,
      keptPct: 75,
    });
  });

  it('为已删除智能体返回保留的历史，对普通用户或不存在对象返回 404', async () => {
    const w = await seeded();
    await call(w.t, '/api/admin/agents/secagent', {
      cookie: w.admin,
      method: 'DELETE',
    });
    const gone = await w.stats(w.admin);
    expect(gone.raised).toBe(7);
    expect(gone.repos).toEqual([]);
    for (const handle of ['octocat', 'nobody'])
      expect(
        (await call(w.t, `/api/agents/${handle}/stats`, { cookie: w.admin }))
          .status
      ).toBe(404);
  });

  it('仅允许已登录成员访问', async () => {
    const w = await seeded();
    expect((await call(w.t, '/api/agents/secagent/stats')).status).toBe(401);
  });
});

describe('GET /api/agents/builtin 内置智能体', () => {
  it('按顺序描述 Clef 和 Fixer', async () => {
    const w = await world();
    const [clef, fixer] = await w.builtin(w.admin);
    expect([clef.id, clef.name, fixer.id, fixer.name]).toEqual([
      'clef',
      'Clef',
      'fixer',
      'Fixer',
    ]);
    expect(clef.job).toMatch(/\S/);
    expect(fixer.job).toMatch(/\S/);
  });

  it('统计 Clef 最近七天的路由数量及决策耗时', async () => {
    const w = await world();
    const c = (
      id: string,
      status: string,
      days: number,
      ms: number | null = null,
      pr = 'a1'
    ) => w.classification(id, pr, id, status, ago(days), ms);
    await c('c1', 'done', 1, 30);
    await c('c2', 'done', 1, 40);
    await c('c3', 'done', 2, 50);
    await c('c4', 'done', 3, 60);
    await c('c5', 'done', 6, 1000);
    await c('c6', 'reviewing', 1);
    // Not routed: still summarizing, or failed.
    await c('c7', 'failed', 1);
    await c('c8', 'summarizing', 1);
    // Too old.
    await c('c9', 'done', 8, 99999);
    // In a private repository.
    await w.classification('c10', 's1', 'c10', 'done', ago(1), 10);

    const clef = (await w.builtin(w.admin))[0];
    expect(clef.stats).toEqual([
      { label: 'changes routed', value: '7' },
      { label: 'per review', value: '45 ms' },
    ]);
    // Test runs picked has no data behind it (the relevance decision is only in the run's log): left out.
    expect(clef.stats.map((s) => s.label)).not.toContain('test runs picked');
    expect((await w.builtin(w.bob))[0].stats).toEqual([
      { label: 'changes routed', value: '6' },
      { label: 'per review', value: '50 ms' },
    ]);
  });

  it('较慢决定以秒或分钟显示，没有完成审查时不提供耗时', async () => {
    const w = await world();
    expect((await w.builtin(w.admin))[0].stats).toEqual([
      { label: 'changes routed', value: '0' },
    ]);
    await w.classification('c1', 'a1', 'c1', 'done', ago(1), 1500);
    expect((await w.builtin(w.admin))[0].stats[1]).toEqual({
      label: 'per review',
      value: '1.5 s',
    });
    await w.exec(`UPDATE pr_classifications SET duration_ms = 180000`);
    expect((await w.builtin(w.admin))[0].stats[1].value).toBe('3 min');
    await w.exec(`UPDATE pr_classifications SET duration_ms = 20000`);
    expect((await w.builtin(w.admin))[0].stats[1].value).toBe('20 s');
  });

  it('根据运行统计 Fixer 尝试次数、自行解决次数及最终合并次数', async () => {
    const w = await world();
    const r = (
      id: string,
      kind: string,
      status: string,
      days: number,
      pr: string | null = 'a2',
      repo = w.app
    ) => w.run(id, repo, pr, kind, status, ago(days));
    // Combined by Fixer.
    await r('r1', 'rebase', 'succeeded', 1);
    await r('r2', 'rebase', 'succeeded', 2);
    await r('r3', 'rebase', 'succeeded', 3);
    await r('r4', 'conflict_resolution', 'succeeded', 1);
    // Handed back: a1 and a5 merged afterwards anyway (a1 twice counts once), a2 is open, a4 closed.
    await r('r5', 'rebase', 'failed', 3, 'a1');
    await r('r6', 'rebase', 'failed', 4, 'a1');
    await r('r7', 'rebase', 'failed', 3, 'a2');
    await r('r8', 'rebase', 'failed', 3, 'a4');
    await r('r9', 'rebase', 'failed', 4, 'a5');
    // Still going.
    await r('r10', 'rebase', 'running', 0);
    // Not Fixer's work, or too old.
    await r('r11', 'review', 'succeeded', 1);
    await r('r12', 'stack_discovery', 'failed', 1);
    await r('r13', 'rebase', 'failed', 8, 'a1');
    // A pull request that merged before the run started did not merge "anyway".
    await w.pr(w.app, 'a6', 6, 'merged', ago(3));
    await r('r14', 'rebase', 'failed', 1, 'a6');
    // In a private repository.
    await r('r15', 'rebase', 'failed', 3, 's1', w.secret);
    await w.exec(
      `UPDATE pull_requests SET state = 'merged', merged_at = ? WHERE id = 's1'`,
      ago(1)
    );
    await r('r16', 'rebase', 'succeeded', 3, 's1', w.secret);

    const fixer = (await w.builtin(w.admin))[1];
    expect(fixer.stats).toEqual([
      { label: 'attempts', value: '13' },
      { label: 'combined', value: '5' },
      { label: 'merged anyway', value: '3' },
    ]);
    expect((await w.builtin(w.bob))[1].stats).toEqual([
      { label: 'attempts', value: '11' },
      { label: 'combined', value: '4' },
      { label: 'merged anyway', value: '2' },
    ]);
  });

  it('Fixer 尚未运行时显示零', async () => {
    const w = await world();
    expect((await w.builtin(w.admin))[1].stats).toEqual([
      { label: 'attempts', value: '0' },
      { label: 'combined', value: '0' },
      { label: 'merged anyway', value: '0' },
    ]);
  });

  it('仅允许已登录成员访问', async () => {
    const w = await world();
    expect((await call(w.t, '/api/agents/builtin')).status).toBe(401);
  });
});
