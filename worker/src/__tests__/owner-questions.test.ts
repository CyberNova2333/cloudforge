// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import {
  parseAgentReview,
  plainQuestion,
  REVIEW_SCHEMA,
  reviewSystemPrompt,
} from '../review/contract';
import { decideFlag } from '../review/flags';
import { reviewGateFor } from '../review/gate';
import { addMember, call, settle, type TestEnv } from './helpers/app';
import {
  collaborate,
  findingAudit,
  flagCall,
  flagState,
  QUESTION,
  questionedPull,
  userId,
} from './helpers/findings';

type Inbox = {
  assignedToMe: number;
  count: number;
  items: {
    agents: {
      flags: {
        id: string;
        question: string | null;
        guarded: boolean;
        assignee: {
          login: string;
          name: string | null;
          isAgent: boolean;
          color: string | null;
        } | null;
        decidedVia: string | null;
        reason: string | null;
        teach: string | null;
      }[];
    }[];
  }[];
};
const inbox = async (t: TestEnv, cookie: string) => {
  const res = await call(t, '/api/approvals', { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Inbox;
};

describe('审查约定中的负责人问题', () => {
  it('要求模型为需人工处理的意见提出简单的是非问题', () => {
    const item = REVIEW_SCHEMA.properties.findings.items;
    expect(item.required).toContain('question');
    expect(item.properties.question).toMatchObject({
      type: 'string',
      maxLength: 200,
    });
    const prompt = reviewSystemPrompt('dataagent');
    expect(prompt).toContain('question');
    expect(prompt).toMatch(/yes\/no/);
  });

  it('为需人工处理的意见保留简单问题，不为修改请求保留问题', () => {
    const review = parseAgentReview(
      JSON.stringify({
        verdict: 'findings',
        summary: 'Two.',
        findings: [
          {
            kind: 'needs_person',
            title: 'Currency',
            detail: 'Invoices get a currency.',
            question: `  ${QUESTION} `,
          },
          {
            kind: 'change_requested',
            title: 'Name',
            detail: 'Rename it.',
            question: 'Should it be renamed?',
          },
        ],
      }),
      []
    );
    expect(review.findings.map((f) => f.question)).toEqual([QUESTION, null]);
  });

  it('丢弃过长、非问句或含有大量代码术语的问题', () => {
    expect(plainQuestion(QUESTION)).toBe(QUESTION);
    // Plain English that only looks like code stays.
    for (const plain of [
      'Were any invoices billed in U.S. dollars?',
      'Should the iPhone app keep CSV export?',
      'Do customers pay monthly and/or yearly?',
    ])
      expect(plainQuestion(plain), plain).toBe(plain);
    // A Chinese question ends with a full-width question mark.
    expect(plainQuestion('要继续给老客户按旧价格收费吗？')).toBe(
      '要继续给老客户按旧价格收费吗？'
    );
    expect(plainQuestion('要继续给老客户按旧价格收费。')).toBeNull();
    expect(plainQuestion('')).toBeNull();
    expect(plainQuestion(null)).toBeNull();
    expect(plainQuestion(42)).toBeNull();
    expect(plainQuestion('Invoices get a currency.')).toBeNull();
    expect(plainQuestion(`${'Is this fine '.repeat(20)}?`)).toBeNull();
    for (const jargon of [
      'Is it fine that `token` is logged?',
      'Should src/auth.ts log tokens?',
      'Is auth.ts allowed to log?',
      'Is invoice_currency always set?',
      'Can invoiceCurrency be empty?',
      'Is getUser() safe here?',
      'Should the {id} route be public?',
    ])
      expect(plainQuestion(jargon), jargon).toBeNull();
    // One line: a newline in the middle is folded.
    expect(plainQuestion('Were all invoices\nin Canadian dollars?')).toBe(
      'Were all invoices in Canadian dollars?'
    );
  });

  it('在审查意见中存储问题，并展示在待审批页面', async () => {
    const { t, admin, person, change } = await questionedPull();
    expect((await flagState(t, person.id))!.question).toBe(QUESTION);
    expect((await flagState(t, change.id))!.question).toBeNull();
    const body = await inbox(t, admin);
    expect(body.items[0].agents[0].flags[0]).toMatchObject({
      id: person.id,
      question: QUESTION,
      guarded: false,
      assignee: null,
      decidedVia: null,
      reason: null,
      teach: null,
    });
  });
});

describe('获取单条审查意见（GET /api/approvals/flags/{id}）', () => {
  type Detail = {
    id: string;
    kind: string;
    title: string;
    question: string | null;
    detail: string | null;
    headSha: string;
    guarded: boolean;
    state: string;
    repo: { fullName: string };
    pull: {
      number: number;
      title: string;
      state: string;
      headSha: string | null;
      author: { login: string };
    };
    agent: {
      login: string;
      name: string;
      color: string;
      guarded: boolean;
    } | null;
    can: { decide: boolean; undo: boolean; delegate: boolean; assign: boolean };
    history: { action: string; actor: { login: string | null } }[];
  };
  const get = async (t: TestEnv, cookie: string, id: string) =>
    call(t, `/api/approvals/flags/${id}`, { cookie });

  it('返回审查意见及其拉取请求、代理、代码片段和历史', async () => {
    const { t, admin, head, person } = await questionedPull();
    const res = await get(t, admin, person.id);
    expect(res.status).toBe(200);
    const d = (await res.json()) as Detail;
    expect(d).toMatchObject({
      id: person.id,
      kind: 'needs_person',
      title: 'Invoice currency',
      question: QUESTION,
      headSha: head,
      guarded: false,
      state: 'open',
      repo: { fullName: 'octocat/app' },
      pull: {
        number: 1,
        state: 'open',
        headSha: head,
        author: { login: 'octocat' },
      },
      agent: { login: 'dataagent', name: 'Data', guarded: false },
      can: { decide: true, undo: false, delegate: true, assign: true },
      history: [],
    });
    expect(d.detail).toContain('Existing invoices would be marked');
    expect(d.agent!.color).toMatch(/^#[0-9a-f]{6}$/);

    expect(
      (
        await flagCall(t, admin, person.id, 'approve', {
          teach: 'Old invoices are in Canadian dollars.',
        })
      ).status
    ).toBe(200);
    const after = (await (await get(t, admin, person.id)).json()) as Detail;
    expect(after.state).toBe('approved');
    expect(after.can.undo).toBe(true);
    expect(after.history.map((h) => h.action)).toEqual([
      'finding.approved',
      'finding.taught',
    ]);
    expect(after.history[0].actor.login).toBe('octocat');
  });

  it('意见不存在或调用者无权读取私有仓库时返回 404', async () => {
    const { t, admin, person } = await questionedPull();
    expect((await get(t, admin, 'nope')).status).toBe(404);
    const bob = await addMember(t, admin, 'bob');
    // Internal: bob reads it, but can't decide.
    const seen = (await (await get(t, bob, person.id)).json()) as Detail;
    expect(seen.can).toEqual({
      decide: false,
      undo: false,
      delegate: false,
      assign: false,
    });
    await t.env.DB.prepare(
      `UPDATE repositories SET visibility = 'private' WHERE name = 'app'`
    ).run();
    expect((await get(t, bob, person.id)).status).toBe(404);
  });
});

describe('指派审查意见', () => {
  it('指派人和被指派人都需要推送权限', async () => {
    const { t, admin, person } = await questionedPull();
    const bob = await addMember(t, admin, 'bob');
    const cho = await addMember(t, admin, 'cho');
    // bob reads the repository but can't push: he can't assign, nor be assigned.
    expect(
      (await flagCall(t, bob, person.id, 'assign', { login: 'cho' })).status
    ).toBe(403);
    const noPush = await flagCall(t, admin, person.id, 'assign', {
      login: 'bob',
    });
    expect(noPush.status).toBe(422);
    expect(((await noPush.json()) as { error: string }).error).toMatch(/push/);
    // Agents and unknown people can't be assigned.
    expect(
      (await flagCall(t, admin, person.id, 'assign', { login: 'dataagent' }))
        .status
    ).toBe(422);
    expect(
      (await flagCall(t, admin, person.id, 'assign', { login: 'nobody' }))
        .status
    ).toBe(404);
    expect((await flagState(t, person.id))!.assignee_id).toBeNull();

    await collaborate(t, admin, 'cho');
    const ok = await flagCall(t, admin, person.id, 'assign', { login: 'cho' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      assignee: { login: 'cho', name: 'cho', isAgent: false, color: null },
    });
    const row = (await flagState(t, person.id))!;
    expect(row.assignee_id).toBe(await userId(t, 'cho'));
    expect(row.assigned_by_id).toBe(await userId(t, 'octocat'));
    expect(row.assigned_at).not.toBeNull();
    expect(await findingAudit(t)).toMatchObject([
      {
        action: 'finding.assigned',
        actor: 'octocat',
        target: 'Invoice currency',
        data: { finding: person.id, assignee: 'cho', agent: 'dataagent' },
      },
    ]);

    // cho has push rights now: cho can pass it on (back to octocat), or clear it.
    expect(
      (await flagCall(t, cho, person.id, 'assign', { login: 'octocat' })).status
    ).toBe(200);
    expect(
      (await flagCall(t, cho, person.id, 'assign', { login: null })).status
    ).toBe(200);
    expect((await flagState(t, person.id))!.assignee_id).toBeNull();
  });

  it('在待审批页面统计指派给自己的意见，并展示被指派人', async () => {
    const { t, admin, person } = await questionedPull();
    const cho = await addMember(t, admin, 'cho');
    await collaborate(t, admin, 'cho');
    expect((await inbox(t, admin)).assignedToMe).toBe(0);
    await flagCall(t, admin, person.id, 'assign', { login: 'cho' });
    expect((await inbox(t, admin)).assignedToMe).toBe(0);
    const theirs = await inbox(t, cho);
    expect(theirs.assignedToMe).toBe(1);
    expect(theirs.items[0].agents[0].flags[0].assignee).toEqual({
      login: 'cho',
      name: 'cho',
      isAgent: false,
      color: null,
    });
    // Decided: it no longer waits on anyone.
    await flagCall(t, cho, person.id, 'approve');
    expect((await inbox(t, cho)).assignedToMe).toBe(0);
  });

  it('拉取请求关闭后拒绝指派', async () => {
    const { t, admin, person } = await questionedPull();
    await call(t, '/api/repos/octocat/app/pulls/1', {
      cookie: admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    await settle(t);
    expect(
      (await flagCall(t, admin, person.id, 'assign', { login: 'octocat' }))
        .status
    ).toBe(400);
  });
});

describe('受保护意见的决策', () => {
  it('批准受保护代理的意见时必须提供理由', async () => {
    const { t, admin, person, change } = await questionedPull({
      guarded: true,
    });
    // Requesting changes never needs one.
    expect(
      (await flagCall(t, admin, person.id, 'request-changes', {})).status
    ).toBe(200);
    for (const body of [undefined, {}, { reason: '   ' }]) {
      const res = await flagCall(t, admin, person.id, 'approve', body);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/reason/);
    }
    // Dismissing its change request is approving it too.
    expect((await flagCall(t, admin, change.id, 'approve')).status).toBe(422);
    expect((await flagState(t, person.id))!.approved_at).toBeNull();

    const ok = await flagCall(t, admin, person.id, 'approve', {
      reason: 'Accepted risk',
    });
    expect(ok.status).toBe(200);
    expect(await flagState(t, person.id)).toMatchObject({
      decision_reason: 'Accepted risk',
      approved_by_id: await userId(t),
      changes_requested_at: null,
    });
    expect((await findingAudit(t)).at(-1)).toMatchObject({
      action: 'finding.approved',
      data: { finding: person.id, reason: 'Accepted risk' },
    });
    expect((await inbox(t, admin)).items).toEqual([]);
  });

  it('将受保护代理的意见标记为受保护', async () => {
    const { t, admin, person } = await questionedPull({ guarded: true });
    expect((await inbox(t, admin)).items[0].agents[0].flags[0]).toMatchObject({
      id: person.id,
      guarded: true,
    });
  });

  it('同样拒绝审核应用在没有理由时批准', async () => {
    const { t, person } = await questionedPull({ guarded: true });
    const db = drizzle(t.env.DB, { schema });
    const pr = (await db.query.pullRequests.findFirst())!;
    const after = (w: Promise<unknown>) => t.ctx.waitUntil(w);
    const me = await userId(t);
    expect(
      await decideFlag(
        t.env,
        db,
        pr,
        person.id,
        me,
        { kind: 'approve' },
        after,
        {
          via: 'Claude Mod',
        }
      )
    ).toMatchObject({ ok: false, status: 422 });
    expect(
      await decideFlag(
        t.env,
        db,
        pr,
        person.id,
        me,
        { kind: 'approve', reason: 'False positive' },
        after,
        { via: 'Claude Mod' }
      )
    ).toEqual({ ok: true });
    await settle(t);
  });

  it('不允许用户对提交的批准覆盖受保护意见', async () => {
    const { t, admin, head, person } = await questionedPull({
      guarded: true,
    });
    const db = drizzle(t.env.DB, { schema });
    const pr = (await db.query.pullRequests.findFirst())!;
    await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
    });
    await settle(t);
    const verdict = await reviewGateFor(db, true, pr, head);
    expect(verdict.satisfied).toBe(false);
    expect(verdict.reasons.map((r) => r.kind)).toEqual([
      'agent_changes_requested',
      'agent_flagged',
    ]);
    expect(
      verdict.reasons.find((r) => r.kind === 'agent_flagged')
    ).toMatchObject({ flags: [{ id: person.id }] });
    // Approve-and-merge is refused by review.
    const merged = await call(t, '/api/repos/octocat/app/pulls/1/merge', {
      cookie: admin,
      json: { approve: true },
    });
    expect(merged.status).toBe(409);
    await settle(t);
  });
});

describe('通过决策提供教学反馈', () => {
  it('随批准或修改请求保存教学说明并记录操作', async () => {
    const { t, admin, person } = await questionedPull();
    const res = await flagCall(t, admin, person.id, 'request-changes', {
      note: 'Ask which invoices were in US dollars.',
      teach: 'Ask before backfilling a currency on old invoices.',
    });
    expect(res.status).toBe(200);
    expect(await flagState(t, person.id)).toMatchObject({
      changes_requested_note: 'Ask which invoices were in US dollars.',
      teach_note: 'Ask before backfilling a currency on old invoices.',
      teach_by_id: await userId(t),
    });
    expect((await findingAudit(t)).map((e) => e.action)).toEqual([
      'finding.changes_requested',
      'finding.taught',
    ]);
    expect((await findingAudit(t))[1]).toMatchObject({
      target: 'Invoice currency',
      data: {
        finding: person.id,
        teach: 'Ask before backfilling a currency on old invoices.',
      },
    });
    expect((await inbox(t, admin)).items[0].agents[0].flags[0].teach).toBe(
      'Ask before backfilling a currency on old invoices.'
    );
    // Too long: refused.
    expect(
      (
        await flagCall(t, admin, person.id, 'approve', {
          teach: 'x'.repeat(1001),
        })
      ).status
    ).toBe(400);
  });

  it('拒绝为已批准的意见添加教学说明，而不是静默丢弃', async () => {
    const { t, admin, person } = await questionedPull();
    expect((await flagCall(t, admin, person.id, 'approve', {})).status).toBe(
      200
    );
    const res = await flagCall(t, admin, person.id, 'approve', {
      teach: 'All invoices are in Canadian dollars.',
    });
    expect(res.status).toBe(409);
    expect(await flagState(t, person.id)).toMatchObject({
      teach_note: null,
    });
    expect((await findingAudit(t)).map((e) => e.action)).toEqual([
      'finding.approved',
    ]);
    // Approving again without a note still keeps the first approval.
    expect((await flagCall(t, admin, person.id, 'approve', {})).status).toBe(
      200
    );
  });
});

describe('撤销决策', () => {
  it('拉取请求仍打开时允许撤销自己的决策，并记录操作', async () => {
    const { t, admin, person } = await questionedPull();
    await flagCall(t, admin, person.id, 'approve', {
      reason: 'Intended behaviour',
      teach: 'All invoices are in Canadian dollars.',
    });
    const res = await flagCall(t, admin, person.id, 'undo');
    expect(res.status).toBe(200);
    expect(await flagState(t, person.id)).toMatchObject({
      approved_at: null,
      approved_by_id: null,
      approved_via: null,
      decision_reason: null,
      teach_note: null,
      teach_by_id: null,
    });
    expect((await findingAudit(t)).at(-1)).toMatchObject({
      action: 'finding.undone',
      actor: 'octocat',
      data: { finding: person.id, undid: 'approved' },
    });
    // Back on Approvals.
    expect((await inbox(t, admin)).items[0].agents[0].flags[0].id).toBe(
      person.id
    );
    // Nothing left to undo.
    expect((await flagCall(t, admin, person.id, 'undo')).status).toBe(409);
  });

  it('拒绝撤销他人的决策', async () => {
    const { t, admin, person } = await questionedPull();
    const cho = await addMember(t, admin, 'cho');
    await collaborate(t, admin, 'cho');
    await flagCall(t, admin, person.id, 'request-changes', {});
    expect((await flagCall(t, cho, person.id, 'undo')).status).toBe(403);
    expect(
      (await flagState(t, person.id))!.changes_requested_at
    ).not.toBeNull();
  });
});
