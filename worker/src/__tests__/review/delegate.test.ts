// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import {
  AI_VIA,
  decideFinding,
  DELEGATE_SCHEMA,
  NO_AI,
  parseDelegateAnswer,
} from '../../review/delegate';
import { addMember, call, settle, type TestEnv } from '../helpers/app';
import {
  fakeDecider,
  findingAudit,
  flagCall,
  flagState,
  guard,
  ONLY_QUESTION,
  QUESTION,
  questionedPull,
  userId,
} from '../helpers/findings';
import { newAgent } from '../helpers/agents';

type Delegations = {
  agents: {
    handle: string;
    name: string;
    color: string;
    guarded: boolean;
    delegated: boolean;
  }[];
  today: {
    id: string;
    at: number;
    actor: { kind: string; login: string | null };
    via: string | null;
    action: string;
    target: string;
    data: Record<string, unknown>;
    repo: string | null;
    pull: number | null;
  }[];
};
const delegations = async (t: TestEnv, cookie: string) => {
  const res = await call(t, '/api/me/delegations', { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Delegations;
};
const setDelegations = (t: TestEnv, cookie: string, agents: string[]) =>
  call(t, '/api/me/delegations', {
    cookie,
    method: 'PUT',
    json: { agents },
  });
const db = (t: TestEnv) => drizzle(t.env.DB, { schema });
const after = (t: TestEnv) => (w: Promise<unknown>) => t.ctx.waitUntil(w);

describe('决策器约定', () => {
  it('仅读取决定和原因，不读取其他内容', () => {
    expect(DELEGATE_SCHEMA.required).toEqual(['decision', 'reason']);
    expect(
      parseDelegateAnswer('{"decision":"approve","reason":" Low risk. "}')
    ).toEqual({ decision: 'approve', reason: 'Low risk.' });
    expect(
      parseDelegateAnswer(
        '```json\n{"decision":"request_changes","reason":"Keep CSV export."}\n```'
      )
    ).toEqual({ decision: 'request_changes', reason: 'Keep CSV export.' });
    for (const bad of [
      'not json',
      '[]',
      '{"decision":"merge","reason":"x"}',
      '{"decision":"approve","reason":""}',
      '{"decision":"approve"}',
    ])
      expect(parseDelegateAnswer(bad), bad).toBeNull();
    // A long reason is cut to 300 characters.
    expect(
      parseDelegateAnswer(
        JSON.stringify({ decision: 'leave', reason: 'x'.repeat(400) })
      )!.reason
    ).toHaveLength(300);
  });
});

describe('让 CloudForge AI 决定（GET/PUT /api/me/delegations）', () => {
  it('列出全部智能体，委托选定项，并拒绝受保护智能体', async () => {
    const { t, admin } = await questionedPull();
    await newAgent(t, admin, 'securityagent', 'Security');
    await guard(t, 'securityagent');
    const before = await delegations(t, admin);
    expect(before.agents).toEqual([
      expect.objectContaining({
        handle: 'dataagent',
        name: 'Data',
        guarded: false,
        delegated: false,
      }),
      expect.objectContaining({
        handle: 'securityagent',
        name: 'Security',
        guarded: true,
        delegated: false,
      }),
    ]);
    expect(before.agents[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(before.today).toEqual([]);

    const refused = await setDelegations(t, admin, [
      'dataagent',
      'securityagent',
    ]);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toMatch(
      /Security/
    );
    expect((await setDelegations(t, admin, ['nobody'])).status).toBe(400);
    expect(
      (await delegations(t, admin)).agents.every((a) => !a.delegated)
    ).toBe(true);

    const ok = await setDelegations(t, admin, ['dataagent']);
    expect(ok.status).toBe(200);
    expect(
      ((await ok.json()) as Delegations).agents.map((a) => [
        a.handle,
        a.delegated,
      ])
    ).toEqual([
      ['dataagent', true],
      ['securityagent', false],
    ]);
    // Each person has their own.
    const bob = await addMember(t, admin, 'bob');
    expect((await delegations(t, bob)).agents.some((a) => a.delegated)).toBe(
      false
    );
    // Taking it back.
    expect((await setDelegations(t, admin, [])).status).toBe(200);
    expect((await delegations(t, admin)).agents.some((a) => a.delegated)).toBe(
      false
    );
  });
});

describe('决定单条审查意见（decideFinding）', () => {
  it('通过 CloudForge AI 以用户身份批准，并记录结果', async () => {
    const { t, person } = await questionedPull();
    const me = await userId(t);
    const decider = fakeDecider();
    const result = await decideFinding(t.env, db(t), person.id, me, {
      model: decider.model,
      after: after(t),
    });
    await settle(t);
    expect(result).toEqual({
      ok: true,
      decision: 'approve',
      reason: 'The change is intended and low risk.',
      applied: true,
    });
    expect(decider.calls).toHaveLength(1);
    expect(decider.calls[0]).toMatchObject({
      agent: { handle: 'dataagent', name: 'Data' },
      finding: {
        title: 'Invoice currency',
        question: QUESTION,
      },
      pull: { title: 'Change things' },
    });
    expect(await flagState(t, person.id)).toMatchObject({
      approved_by_id: me,
      approved_via: AI_VIA,
      decision_reason: 'The change is intended and low risk.',
    });
    expect(await findingAudit(t)).toMatchObject([
      {
        action: 'finding.delegated',
        actor_kind: 'ai',
        actor: 'octocat',
        via: 'CloudForge AI',
        target: 'Invoice currency',
        data: {
          finding: person.id,
          agent: 'dataagent',
          decision: 'approve',
          reason: 'The change is intended and low risk.',
          pull: 1,
        },
      },
    ]);
  });

  it('请求修改，并将原因作为备注', async () => {
    const { t, person } = await questionedPull();
    const me = await userId(t);
    const decider = fakeDecider(() => ({
      decision: 'request_changes',
      reason: 'Ask which invoices were in US dollars first.',
    }));
    const result = await decideFinding(t.env, db(t), person.id, me, {
      model: decider.model,
      after: after(t),
    });
    await settle(t);
    expect(result).toMatchObject({ ok: true, applied: true });
    expect(await flagState(t, person.id)).toMatchObject({
      changes_requested_by_id: me,
      changes_requested_note: 'Ask which invoices were in US dollars first.',
      approved_via: AI_VIA,
      approved_at: null,
    });
  });

  it('选择交给人工、无法答复、调用失败或缺少模型时，保留人工处理并附原因', async () => {
    const { t, person } = await questionedPull();
    const me = await userId(t);
    const leave = fakeDecider(() => ({
      decision: 'leave',
      reason: 'Only you know which currency you billed in.',
    }));
    const cases: [
      Parameters<typeof decideFinding>[4]['model'],
      RegExp | string,
    ][] = [
      [leave.model, 'Only you know which currency you billed in.'],
      [fakeDecider(() => 'no idea').model, /couldn't decide/],
      [
        {
          id: 'x',
          decide: async () => {
            throw new Error('model down');
          },
        },
        /couldn't decide/,
      ],
      [null, NO_AI],
    ];
    for (const [model, reason] of cases) {
      const result = await decideFinding(t.env, db(t), person.id, me, {
        model,
        after: after(t),
      });
      expect(result).toMatchObject({
        ok: true,
        decision: 'leave',
        applied: false,
      });
      if (result.ok) expect(result.reason).toMatch(reason);
    }
    await settle(t);
    expect(await flagState(t, person.id)).toMatchObject({
      approved_at: null,
      changes_requested_at: null,
      decision_reason: null,
    });
    const rows = await findingAudit(t);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.data.decision === 'leave')).toBe(true);
  });

  it('不决定受保护智能体的意见、修改请求或已作出决定的意见', async () => {
    const { t, admin, person, change } = await questionedPull({
      guarded: true,
    });
    const me = await userId(t);
    const decider = fakeDecider();
    const run = (id: string) =>
      decideFinding(t.env, db(t), id, me, {
        model: decider.model,
        after: after(t),
      });
    expect(await run(person.id)).toMatchObject({ ok: false, status: 422 });
    expect(await run(change.id)).toMatchObject({ ok: false, status: 400 });
    expect(await run('nope')).toMatchObject({ ok: false, status: 404 });
    expect(decider.calls).toEqual([]);

    await t.env.DB.prepare('UPDATE agents SET guarded = 0, facet = NULL').run();
    await flagCall(t, admin, person.id, 'request-changes', {});
    expect(await run(person.id)).toMatchObject({ ok: false, status: 409 });
    expect(decider.calls).toEqual([]);
  });

  it('拒绝处理所属智能体已从仓库移除或已删除的审查意见', async () => {
    const { t, person } = await questionedPull();
    const me = await userId(t);
    const decider = fakeDecider();
    const run = () =>
      decideFinding(t.env, db(t), person.id, me, {
        model: decider.model,
        after: after(t),
      });
    const invites = await t.env.DB.prepare(
      'SELECT * FROM repository_agents'
    ).all<Record<string, unknown>>();
    await t.env.DB.prepare('DELETE FROM repository_agents').run();
    expect(await run()).toMatchObject({ ok: false, status: 409 });
    // Invited again, but the agent is deleted.
    for (const r of invites.results)
      await t.env.DB.prepare(
        `INSERT INTO repository_agents (${Object.keys(r).join(', ')}) VALUES (${Object.keys(
          r
        )
          .map(() => '?')
          .join(', ')})`
      )
        .bind(...Object.values(r))
        .run();
    await t.env.DB.prepare('UPDATE agents SET deleted_at = 1').run();
    expect(await run()).toMatchObject({ ok: false, status: 409 });
    expect(decider.calls).toEqual([]);
    expect(await flagState(t, person.id)).toMatchObject({ approved_at: null });
  });

  it('要求用户具备推送权限', async () => {
    const { t, admin, person } = await questionedPull();
    await addMember(t, admin, 'bob');
    const result = await decideFinding(
      t.env,
      db(t),
      person.id,
      await userId(t, 'bob'),
      { model: fakeDecider().model, after: after(t) }
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe('POST .../review/flags/{id}/delegate 委托决策', () => {
  it('通过 AI 绑定立即决定一条审查意见', async () => {
    const { t, admin, person } = await questionedPull();
    const inputs: unknown[] = [];
    (t.env as unknown as { AI: unknown }).AI = {
      run: async (model: string, input: unknown) => {
        inputs.push({ model, input });
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: 'approve',
                  reason: 'Every invoice so far was in Canadian dollars.',
                }),
              },
            },
          ],
          usage: { prompt_tokens: 900, completion_tokens: 40 },
        };
      },
    };
    const res = await flagCall(t, admin, person.id, 'delegate');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      decision: 'approve',
      reason: 'Every invoice so far was in Canadian dollars.',
      applied: true,
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ model: '@cf/zai-org/glm-5.3' });
    expect((await flagState(t, person.id))!.approved_via).toBe(AI_VIA);
    const usage = await t.env.DB.prepare(
      "SELECT feature, model, tokens_in FROM ai_usage WHERE feature = 'review-delegate'"
    ).first();
    expect(usage).toEqual({
      feature: 'review-delegate',
      model: '@cf/zai-org/glm-5.3',
      tokens_in: 900,
    });
  });

  it('没有 AI 绑定时保留意见，并拒绝受保护意见或只读用户请求', async () => {
    const { t, admin, person } = await questionedPull();
    const res = await flagCall(t, admin, person.id, 'delegate');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      decision: 'leave',
      reason: NO_AI,
      applied: false,
    });
    const bob = await addMember(t, admin, 'bob');
    expect((await flagCall(t, bob, person.id, 'delegate')).status).toBe(403);
    await guard(t, 'dataagent');
    const guarded = await flagCall(t, admin, person.id, 'delegate');
    expect(guarded.status).toBe(422);
  });
});

describe('审查完成之后', () => {
  const delegate =
    (handles: string[]) =>
    async ({ t, admin }: { t: TestEnv; admin: string }) => {
      expect((await setDelegations(t, admin, handles)).status).toBe(200);
    };

  it('在委托者的拉取请求中决定已委托智能体的审查意见', async () => {
    const decider = fakeDecider();
    const { t, admin, person, change } = await questionedPull({
      beforeReview: delegate(['dataagent']),
      delegate: decider.model,
    });
    // The finding for a person was decided; the agent's change request is the pull request's agent's.
    expect(decider.calls).toHaveLength(1);
    expect(await flagState(t, person.id)).toMatchObject({
      approved_by_id: await userId(t),
      approved_via: AI_VIA,
    });
    expect((await flagState(t, change.id))!.approved_at).toBeNull();

    // What CloudForge AI did today, for this person: undoable while the pull request is open.
    const today = (await delegations(t, admin)).today;
    expect(today).toMatchObject([
      {
        actor: { kind: 'ai', login: 'octocat' },
        via: AI_VIA,
        action: 'finding.delegated',
        target: 'Invoice currency',
        repo: 'octocat/app',
        pull: 1,
        data: {
          finding: person.id,
          decision: 'approve',
          undone: false,
          undoable: true,
        },
      },
    ]);
    // Someone else's list is empty.
    const bob = await addMember(t, admin, 'bob');
    expect((await delegations(t, bob)).today).toEqual([]);

    // Undo: the finding waits for the person again, and today's entry says so.
    expect((await flagCall(t, admin, person.id, 'undo')).status).toBe(200);
    expect(await flagState(t, person.id)).toMatchObject({
      approved_at: null,
      approved_via: null,
    });
    expect((await delegations(t, admin)).today[0].data).toMatchObject({
      undone: true,
      undoable: false,
    });
  });

  it('智能体未被委托时不处理其审查意见', async () => {
    const decider = fakeDecider();
    const { t, person } = await questionedPull({ delegate: decider.model });
    expect((await flagState(t, person.id))!.approved_at).toBeNull();
    expect(decider.calls).toEqual([]);
  });

  it('不决定受保护智能体的意见，即使在启用保护前已委托', async () => {
    const decider = fakeDecider();
    const { t, person } = await questionedPull({
      beforeReview: async (s) => {
        await delegate(['dataagent'])(s);
        await guard(s.t, 'dataagent');
      },
      delegate: decider.model,
    });
    expect((await flagState(t, person.id))!.approved_at).toBeNull();
    expect(decider.calls).toEqual([]);
    expect(await findingAudit(t)).toEqual([]);
  });

  it('不处理他人拉取请求中的审查意见', async () => {
    const decider = fakeDecider();
    // cho delegated the agent, but octocat opened the pull request.
    const { t, person } = await questionedPull({
      beforeReview: async ({ t, admin }) => {
        const cho = await addMember(t, admin, 'cho');
        expect((await setDelegations(t, cho, ['dataagent'])).status).toBe(200);
      },
      delegate: decider.model,
    });
    expect((await flagState(t, person.id))!.approved_at).toBeNull();
    expect(decider.calls).toEqual([]);
  });

  it('拉取请求已合并后保留 AI 决定，拒绝撤销', async () => {
    const { t, admin, person } = await questionedPull({
      review: ONLY_QUESTION,
      beforeReview: delegate(['dataagent']),
      delegate: fakeDecider().model,
    });
    // Its only finding approved, the pull request merged on its own.
    const state = await t.env.DB.prepare(
      'SELECT state FROM pull_requests WHERE number = 1'
    ).first<{ state: string }>();
    expect(state!.state).toBe('merged');
    const res = await flagCall(t, admin, person.id, 'undo');
    expect(res.status).toBe(409);
    expect((await flagState(t, person.id))!.approved_via).toBe(AI_VIA);
    expect((await delegations(t, admin)).today[0].data).toMatchObject({
      undone: false,
      undoable: false,
    });
  });

  it('仅列出 UTC 零点以来的今日决定', async () => {
    const { t, admin } = await questionedPull({
      beforeReview: delegate(['dataagent']),
      delegate: fakeDecider().model,
    });
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    await t.env.DB.prepare('UPDATE audit_events SET created_at = ?')
      .bind(midnight.getTime() - 1)
      .run();
    expect((await delegations(t, admin)).today).toEqual([]);
  });
});
