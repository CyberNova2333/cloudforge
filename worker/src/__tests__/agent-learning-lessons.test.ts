// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { learnSystemPrompt, learnUserPrompt } from '../learn/contract';
import { lessonInput, loadLesson } from '../learn/lessons';
import { call, settle } from './helpers/app';
import { agentModels, BASE, runReviews, startReview } from './helpers/reviews';
import { commitPaths } from './helpers/seed';
import {
  CHANGE,
  closePull,
  decide,
  FINDINGS,
  findings,
  lessons,
  mergePull,
  ONE_CHANGE_REQUEST,
  reviewedPull,
} from './helpers/lessons';

const changeRequests = async (
  t: Awaited<ReturnType<typeof reviewedPull>>['t'],
  agent = 'secagent'
) =>
  (await findings(t)).filter(
    (f) => f.agent === agent && f.kind === 'change_requested'
  );

describe('从被驳回的修改请求中学习', () => {
  it('拉取请求关闭时，为每个修改请求被人工驳回的智能体排入一个学习任务', async () => {
    const { t, admin } = await reviewedPull(['perfagent', 'secagent']);
    const sec = await changeRequests(t);
    for (const f of sec) await decide(t, admin, f.id);
    // perfagent: only its finding for a person is approved; its change requests stay open.
    const person = (await findings(t)).find(
      (f) => f.agent === 'perfagent' && f.kind === 'needs_person'
    )!;
    await decide(t, admin, person.id);
    // Nothing while the pull request is open.
    expect(await lessons(t)).toEqual([]);

    await closePull(t, admin);
    const rows = await lessons(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent: 'secagent',
      status: 'pending',
      attempts: 0,
      run_id: null,
      base_sha: null,
      commit_sha: null,
      retryable: 0,
    });
    expect(JSON.parse(rows[0].finding_ids)).toEqual(sec.map((f) => f.id));
  });

  it('没有修改请求被驳回时，不排入学习任务', async () => {
    const { t, admin } = await reviewedPull();
    const person = (await findings(t)).find((f) => f.kind === 'needs_person')!;
    await decide(t, admin, person.id);
    await closePull(t, admin);
    expect(await lessons(t)).toEqual([]);
  });

  it('仅学习一次：重新打开再关闭时不添加第二个任务', async () => {
    const { t, admin } = await reviewedPull();
    for (const f of await changeRequests(t)) await decide(t, admin, f.id);
    await closePull(t, admin);
    const [first] = await lessons(t);
    await closePull(t, admin, 'open');
    await closePull(t, admin);
    expect((await lessons(t)).map((l) => l.id)).toEqual([first.id]);
  });

  it('通过合并按钮合并拉取请求时，排入学习任务', async () => {
    // The finding for a person stays open, so nothing auto-merges before the merge button.
    const { t, admin } = await reviewedPull();
    const crs = await changeRequests(t);
    for (const f of crs) await decide(t, admin, f.id);
    expect(await lessons(t)).toEqual([]);
    await mergePull(t, admin);
    const rows = await lessons(t);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].finding_ids)).toEqual(crs.map((f) => f.id));
  });

  it('拉取请求自动合并时，排入学习任务', async () => {
    // Dismissing the only change request clears the review gate: the pull request lands by itself.
    const { t, admin } = await reviewedPull(['secagent'], ONE_CHANGE_REQUEST);
    const [cr] = await changeRequests(t);
    await decide(t, admin, cr.id);
    const rows = await lessons(t);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].finding_ids)).toEqual([cr.id]);
  });

  it('计入拉取请求较早提交上被驳回的修改请求', async () => {
    const { t, admin, repo } = await reviewedPull();
    const [cr] = await changeRequests(t);
    await decide(t, admin, cr.id);
    // A newer commit, reviewed again; its findings stay open, so the pull request stays open.
    await commitPaths(
      repo,
      'feature',
      { ...BASE, ...CHANGE, 'src/more.ts': 'export const b = 1;\n' },
      'More'
    );
    await startReview(t);
    await runReviews(t, agentModels({ review: () => FINDINGS }).models);
    await closePull(t, admin);
    expect(JSON.parse((await lessons(t))[0].finding_ids)).toEqual([cr.id]);
  });

  it('跳过在拉取请求关闭前已删除的智能体', async () => {
    const { t, admin } = await reviewedPull();
    for (const f of await changeRequests(t)) await decide(t, admin, f.id);
    const res = await call(t, '/api/admin/agents/secagent', {
      cookie: admin,
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    await closePull(t, admin);
    expect(await lessons(t)).toEqual([]);
  });
});

describe('从人工指导中学习', () => {
  type T = Awaited<ReturnType<typeof reviewedPull>>['t'];
  const db = (t: T) => drizzle(t.env.DB, { schema });
  const teach = async (
    t: T,
    cookie: string,
    id: string,
    verb: 'approve' | 'request-changes',
    note: string
  ) => {
    const res = await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${id}/${verb}`,
      { cookie, method: 'POST', json: { teach: note } }
    );
    expect(res.status, await res.clone().text()).toBe(200);
    await settle(t);
  };
  const RULE = 'Rotation is handled by the vault: never ask about it.';

  it('人工批准审查意见并附带指导说明时排入学习任务，将原话作为规则交给学习器', async () => {
    const { t, admin } = await reviewedPull();
    const person = (await findings(t)).find((f) => f.kind === 'needs_person')!;
    await teach(t, admin, person.id, 'approve', RULE);
    await closePull(t, admin);
    const rows = await lessons(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].agent).toBe('secagent');
    expect(JSON.parse(rows[0].finding_ids)).toEqual([person.id]);

    const loaded = (await loadLesson(db(t), rows[0].id))!;
    const input = await lessonInput(db(t), loaded);
    expect(input.findings).toMatchObject([
      {
        id: person.id,
        title: 'Secret rotation',
        decision: 'approved',
        rule: RULE,
        dismissedBy: 'octocat',
      },
    ]);
    // The rule is the person's, outside the fence that holds what the pull request says.
    const prompt = learnUserPrompt(input, 'abc123', {
      baseSha: 'f'.repeat(40),
      files: 1,
      skipped: 0,
    });
    const close = prompt.indexOf('</untrusted-abc123>');
    expect(close).toBeGreaterThan(0);
    expect(prompt.slice(0, close)).not.toContain(RULE);
    expect(prompt.slice(close)).toContain(RULE);
    expect(prompt.slice(close)).toContain('@octocat');
    expect(learnSystemPrompt('secagent', 30)).toMatch(/rule/);
  });

  it('按顺序将带指导的审查意见加入被驳回的修改请求，每个智能体生成一个学习任务', async () => {
    const { t, admin } = await reviewedPull();
    const all = await findings(t);
    const [tokenLogged] = all.filter((f) => f.kind === 'change_requested');
    const person = all.find((f) => f.kind === 'needs_person')!;
    await decide(t, admin, tokenLogged.id);
    await teach(t, admin, person.id, 'request-changes', RULE);
    await closePull(t, admin);
    const rows = await lessons(t);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].finding_ids)).toEqual([
      tokenLogged.id,
      person.id,
    ]);
    const input = await lessonInput(
      db(t),
      (await loadLesson(db(t), rows[0].id))!
    );
    expect(input.findings.map((f) => [f.decision, f.rule ?? null])).toEqual([
      ['dismissed', null],
      ['changes_requested', RULE],
    ]);
  });

  it('决定被撤销时，遗忘对应的指导说明', async () => {
    const { t, admin } = await reviewedPull();
    const person = (await findings(t)).find((f) => f.kind === 'needs_person')!;
    await teach(t, admin, person.id, 'approve', RULE);
    const undo = await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${person.id}/undo`,
      { cookie: admin, method: 'POST' }
    );
    expect(undo.status).toBe(200);
    await settle(t);
    await closePull(t, admin);
    expect(await lessons(t)).toEqual([]);
  });
});
