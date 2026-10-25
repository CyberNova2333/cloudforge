// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { pullRequests, repositories } from '../db/app.schema';
import { gitFor } from '../lib/repos';
import { moderatorFor, NOT_MODERATOR } from '../mcp/moderators';
import { MODERATOR_TOOLS } from '../mcp/moderator-tools';
import type { ToolContext } from '../mcp/tools';
import { decideFlag } from '../review/flags';
import { approvePull } from '../review/approvals';
import type { AgentReview } from '../review/contract';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from './helpers/app';
import {
  authorize,
  connect,
  ORIGIN,
  pkce,
  raw,
  REDIRECT,
  rpc,
  tool,
} from './helpers/mcp';
import { commitPaths } from './helpers/seed';
import {
  agentModels,
  appRepo,
  flags,
  invitedAgent,
  openPull,
  runReviews,
  startReview,
} from './helpers/reviews';

type App = {
  clientId: string;
  name: string;
  moderator: boolean;
  redirectHost: string | null;
};
const apps = async (t: TestEnv, cookie: string) =>
  (await (await call(t, '/api/mcp/connections', { cookie })).json()) as App[];
const moderatorPath = (clientId: string) =>
  `/api/mcp/connections/${encodeURIComponent(clientId)}/moderator`;
const setModerator = (
  t: TestEnv,
  cookie: string,
  clientId: string,
  on: boolean
) =>
  call(t, moderatorPath(clientId), { cookie, method: on ? 'PUT' : 'DELETE' });
const db = (t: TestEnv) => drizzle(t.env.DB, { schema });
const adminId = async (t: TestEnv) =>
  (await t.env.DB.prepare(
    "SELECT id FROM users WHERE username = 'octocat'"
  ).first<{
    id: string;
  }>())!.id;
const moderatorRows = async (t: TestEnv) =>
  (
    await t.env.DB.prepare(
      'SELECT user_id, client_id FROM mcp_moderators ORDER BY client_id'
    ).all<{ user_id: string; client_id: string }>()
  ).results;

describe('将已连接应用设为审核应用', () => {
  it('列出各应用的审核权限，并允许开启和关闭', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const mod = await connect(t, admin, 'Claude Mod');
    const coder = await connect(t, admin, 'Claude Code');
    expect(
      (await apps(t, admin)).map((a) => [a.name, a.moderator]).sort()
    ).toEqual([
      ['Claude Code', false],
      ['Claude Mod', false],
    ]);

    const on = await setModerator(t, admin, mod.clientId, true);
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ ok: true, moderator: true });
    // Idempotent.
    expect((await setModerator(t, admin, mod.clientId, true)).status).toBe(200);
    const listed = await apps(t, admin);
    expect(listed.find((a) => a.clientId === mod.clientId)?.moderator).toBe(
      true
    );
    expect(listed.find((a) => a.clientId === coder.clientId)?.moderator).toBe(
      false
    );
    expect(await moderatorRows(t)).toHaveLength(1);

    const off = await setModerator(t, admin, mod.clientId, false);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ ok: true, moderator: false });
    expect(await moderatorRows(t)).toEqual([]);
  });

  it('展示各应用的重定向地址以区分同名应用', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await connect(t, admin, 'Claude Code');
    expect((await apps(t, admin))[0].redirectHost).toBe('127.0.0.1');
  });

  it('拒绝用户尚未连接的应用', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const bob = await addMember(t, admin, 'bob');
    const bobs = await connect(t, bob, 'Bob Mod');
    // Someone else's app, and an id nobody registered.
    expect((await setModerator(t, admin, bobs.clientId, true)).status).toBe(
      404
    );
    expect((await setModerator(t, admin, 'no-such-client', true)).status).toBe(
      404
    );
    expect(await moderatorRows(t)).toEqual([]);
    expect((await apps(t, bob))[0].moderator).toBe(false);
  });

  it('仅接受已登录会话修改设置，不接受 MCP 令牌', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const mod = await connect(t, admin, 'Claude Mod');
    const bearer = { Authorization: `Bearer ${mod.access_token}` };
    const put = await call(t, moderatorPath(mod.clientId), {
      method: 'PUT',
      headers: bearer,
    });
    expect(put.status).toBe(401);
    expect(await moderatorRows(t)).toEqual([]);
    // Nor can a token turn it off once the user turned it on.
    await setModerator(t, admin, mod.clientId, true);
    const del = await call(t, moderatorPath(mod.clientId), {
      method: 'DELETE',
      headers: bearer,
    });
    expect(del.status).toBe(401);
    expect(await moderatorRows(t)).toHaveLength(1);
    // Nor list the user's apps.
    expect(
      (await call(t, '/api/mcp/connections', { headers: bearer })).status
    ).toBe(401);
  });

  it('断开应用连接后清除设置', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const mod = await connect(t, admin, 'Claude Mod');
    await setModerator(t, admin, mod.clientId, true);
    const res = await call(
      t,
      `/api/mcp/connections/${encodeURIComponent(mod.clientId)}`,
      { cookie: admin, method: 'DELETE' }
    );
    expect(res.status).toBe(200);
    expect(await moderatorRows(t)).toEqual([]);
    // Reconnecting the same app starts over as an ordinary connection.
    await authorize(t, admin, mod.clientId);
    expect((await apps(t, admin))[0]).toMatchObject({
      clientId: mod.clientId,
      moderator: false,
    });
  });

  it('在已连接应用之外撤销授权后，重新授权不会恢复审核权限', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const mod = await connect(t, admin, 'Claude Mod');
    await setModerator(t, admin, mod.clientId, true);
    expect((await apps(t, admin))[0].moderator).toBe(true);

    // better-auth's own endpoint drops the consent but knows nothing of mcp_moderators.
    const consent = await t.env.DB.prepare(
      'SELECT id FROM oauth_consents WHERE client_id = ?'
    )
      .bind(mod.clientId)
      .first<{ id: string }>();
    const revoked = await call(t, '/api/auth/oauth2/delete-consent', {
      cookie: admin,
      json: { id: consent!.id },
    });
    expect(revoked.status).toBe(200);
    expect(await apps(t, admin)).toEqual([]);
    expect(await moderatorRows(t)).toEqual([]);

    // The re-authorised app is a new consent, so an ordinary connection.
    await authorize(t, admin, mod.clientId);
    expect((await apps(t, admin))[0]).toMatchObject({
      clientId: mod.clientId,
      moderator: false,
    });
    expect(
      await moderatorFor(db(t), await adminId(t), mod.clientId)
    ).toBeNull();

    // Until the user turns it on again.
    expect((await setModerator(t, admin, mod.clientId, true)).status).toBe(200);
    expect((await apps(t, admin))[0].moderator).toBe(true);
    expect(await moderatorFor(db(t), await adminId(t), mod.clientId)).toEqual({
      clientId: mod.clientId,
      name: 'Claude Mod',
    });
  });
});

describe('审核应用的记录名称', () => {
  it('移除控制字符和双向文本控制字符，并限制为 80 个字符', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const spoof = await connect(
      t,
      admin,
      'Claude\u202e doM\u0007\u200f Mod\n' + 'x'.repeat(200)
    );
    await setModerator(t, admin, spoof.clientId, true);
    const got = await moderatorFor(db(t), await adminId(t), spoof.clientId);
    expect(got!.name).toBe(('Claude doM Mod' + 'x'.repeat(200)).slice(0, 80));
    expect(got!.name).toHaveLength(80);

    const blank = await connect(t, admin, '\u202e\u0000 ');
    await setModerator(t, admin, blank.clientId, true);
    expect(
      (await moderatorFor(db(t), await adminId(t), blank.clientId))!.name
    ).toBe('Unnamed app');
  });
});

const FINDINGS: AgentReview = {
  verdict: 'findings',
  summary: 'Two concerns.',
  findings: [
    {
      kind: 'needs_person',
      title: 'New export',
      detail: 'Exports a new constant.',
      changes: [],
      diagram: null,
      snippets: [],
      paths: ['src/a.ts'],
    },
    {
      kind: 'change_requested',
      title: 'Name it',
      detail: 'Rename a to answer.',
      changes: [],
      diagram: null,
      snippets: [],
      paths: ['src/a.ts'],
    },
  ],
};

/** octocat/app#1, reviewed by @secagent: one finding for a person, one change request (in that order). */
async function reviewed() {
  const { t, admin, repo } = await appRepo();
  await invitedAgent(t, admin);
  const { head } = await openPull(t, admin, repo, {
    'src/a.ts': 'export const a = 1;\n',
  });
  await startReview(t);
  await runReviews(t, agentModels({ review: () => FINDINGS }).models);
  const [person, change] = await flags(t);
  expect([person.kind, change.kind]).toEqual([
    'needs_person',
    'change_requested',
  ]);
  return { t, admin, repo, head, person, change };
}

/** What the tools pass in: the database, the pull request row, its git service, and `after`. */
async function target(t: TestEnv) {
  const db = drizzle(t.env.DB, { schema });
  const row = (await db
    .select()
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(eq(pullRequests.number, 1))
    .get())!;
  return {
    db,
    pr: row.pull_requests,
    git: gitFor(t.env, row.repositories),
    after: (w: Promise<unknown>) => t.ctx.waitUntil(w),
  };
}
const userId = async (t: TestEnv, username = 'octocat') =>
  (await t.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>())!.id;
const flagRow = (t: TestEnv, id: string) =>
  t.env.DB.prepare(
    'SELECT approved_by_id, approved_at, approved_via FROM pr_review_flags WHERE id = ?'
  )
    .bind(id)
    .first<{
      approved_by_id: string | null;
      approved_at: number | null;
      approved_via: string | null;
    }>();
const approvalRows = async (t: TestEnv) =>
  (
    await t.env.DB.prepare(
      'SELECT head_sha, user_id, via FROM pr_approvals'
    ).all<{ head_sha: string; user_id: string; via: string | null }>()
  ).results;
const approvedEvents = async (t: TestEnv) =>
  (
    await t.env.DB.prepare(
      "SELECT data FROM pr_events WHERE kind = 'approved'"
    ).all<{ data: string }>()
  ).results.map((e) => JSON.parse(e.data) as Record<string, unknown>);

type Detail = {
  approvals: { user: { username: string }; via: string | null }[];
  review: {
    reviewers: {
      flags: { id: string; approvedVia: string | null }[];
    }[];
  } | null;
};
const detail = async (t: TestEnv, cookie: string) =>
  (await (
    await call(t, '/api/repos/octocat/app/pulls/1', { cookie })
  ).json()) as Detail;

describe('通过审核应用调用网页决策路径', () => {
  it('通过应用处理审查意见时记录应用来源，网页操作不记录', async () => {
    const { t, admin, head, person, change } = await reviewed();
    const { db, pr, git, after } = await target(t);
    const me = await userId(t);
    const res = await decideFlag(
      t.env,
      db,
      pr,
      person.id,
      me,
      { kind: 'approve' },
      after,
      {
        via: 'Claude Mod',
        kind: 'needs_person',
        expectedHead: { sha: head, git },
      }
    );
    expect(res).toEqual({ ok: true });
    expect(await flagRow(t, person.id)).toMatchObject({
      approved_by_id: me,
      approved_via: 'Claude Mod',
    });
    const shown = (await detail(t, admin)).review!.reviewers[0].flags;
    expect(shown.find((f) => f.id === person.id)?.approvedVia).toBe(
      'Claude Mod'
    );
    expect(shown.find((f) => f.id === change.id)?.approvedVia).toBeNull();
    // The web's Dismiss: same function, no via.
    const web = await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${change.id}/approve`,
      { cookie: admin, method: 'POST' }
    );
    expect(web.status).toBe(200);
    expect(await flagRow(t, change.id)).toMatchObject({
      approved_by_id: me,
      approved_via: null,
    });
    await settle(t);
  });

  it('拒绝类型不匹配的审查意见', async () => {
    const { t, head, person, change } = await reviewed();
    const { db, pr, git, after } = await target(t);
    const me = await userId(t);
    const asPerson = await decideFlag(
      t.env,
      db,
      pr,
      change.id,
      me,
      { kind: 'approve' },
      after,
      {
        via: 'Claude Mod',
        kind: 'needs_person',
        expectedHead: { sha: head, git },
      }
    );
    expect(asPerson).toMatchObject({ ok: false, status: 400 });
    expect(asPerson.ok ? '' : asPerson.error).toMatch(/change request/);
    const asChange = await decideFlag(
      t.env,
      db,
      pr,
      person.id,
      me,
      { kind: 'approve' },
      after,
      {
        via: 'Claude Mod',
        kind: 'change_requested',
        expectedHead: { sha: head, git },
      }
    );
    expect(asChange).toMatchObject({ ok: false, status: 400 });
    expect(asChange.ok ? '' : asChange.error).toMatch(/approval/);
    expect((await flagRow(t, person.id))!.approved_at).toBeNull();
    expect((await flagRow(t, change.id))!.approved_at).toBeNull();
  });

  it('拒绝决策者未查看的分支头和旧分支头上的审查意见', async () => {
    const { t, repo, head, person } = await reviewed();
    const { db, pr, git, after } = await target(t);
    const me = await userId(t);
    const decide = (sha: string) =>
      decideFlag(t.env, db, pr, person.id, me, { kind: 'approve' }, after, {
        via: 'Claude Mod',
        kind: 'needs_person',
        expectedHead: { sha, git },
      });
    // A made-up head, and the right head abbreviated.
    expect(await decide('f'.repeat(40))).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await decide(head.slice(0, 7))).toMatchObject({
      ok: false,
      status: 409,
    });
    // A new commit: the old head is stale, and the finding was raised on the old head.
    const newer = await commitPaths(
      repo,
      'feature',
      {
        'src/app.ts': 'export const a = 1;\n',
        'src/a.ts': 'export const answer = 1;\n',
      },
      'Rename'
    );
    const stale = await decide(head);
    expect(stale).toMatchObject({ ok: false, status: 409 });
    expect(stale.ok ? '' : stale.error).toMatch(/new commits since you looked/);
    expect(await decide(newer)).toMatchObject({ ok: false, status: 409 });
    expect(await flagRow(t, person.id)).toMatchObject({
      approved_at: null,
      approved_via: null,
    });
  });

  it('保留对审查意见的首次决策', async () => {
    const { t, admin, head, person } = await reviewed();
    const web = await call(
      t,
      `/api/repos/octocat/app/pulls/1/review/flags/${person.id}/approve`,
      { cookie: admin, method: 'POST' }
    );
    expect(web.status).toBe(200);
    const before = await flagRow(t, person.id);
    const { db, pr, git, after } = await target(t);
    const again = await decideFlag(
      t.env,
      db,
      pr,
      person.id,
      await userId(t),
      { kind: 'approve' },
      after,
      {
        via: 'Claude Mod',
        kind: 'needs_person',
        expectedHead: { sha: head, git },
      }
    );
    expect(again).toEqual({ ok: true });
    expect(await flagRow(t, person.id)).toEqual(before);
    expect(before!.approved_via).toBeNull();
    await settle(t);
  });

  it('通过应用批准提交时，在批准记录及时间线事件中记录应用来源', async () => {
    const { t, admin, head } = await reviewed();
    const { db, pr, git, after } = await target(t);
    const res = await approvePull(t.env, db, git, pr, await userId(t), after, {
      expectedHead: head,
      via: 'Claude Mod',
    });
    expect(res).toEqual({ ok: true, headSha: head });
    expect(await approvalRows(t)).toMatchObject([
      { head_sha: head, via: 'Claude Mod' },
    ]);
    expect(await approvedEvents(t)).toMatchObject([
      { head_sha: head, via: 'Claude Mod' },
    ]);
    expect((await detail(t, admin)).approvals).toMatchObject([
      { user: { username: 'octocat' }, via: 'Claude Mod' },
    ]);
    await settle(t);
  });

  it('保留提交的首次批准及其来源', async () => {
    const { t, admin, head } = await reviewed();
    const web = await call(t, '/api/repos/octocat/app/pulls/1/approval', {
      cookie: admin,
      method: 'POST',
      json: { headSha: head },
    });
    expect(web.status).toBe(200);
    const { db, pr, git, after } = await target(t);
    const again = await approvePull(
      t.env,
      db,
      git,
      pr,
      await userId(t),
      after,
      { expectedHead: head, via: 'Claude Mod' }
    );
    expect(again).toEqual({ ok: true, headSha: head });
    expect(await approvalRows(t)).toMatchObject([{ via: null }]);
    const events = await approvedEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('via');
    expect((await detail(t, admin)).approvals).toMatchObject([{ via: null }]);
    await settle(t);
  });
});

const MOD_TOOLS = [
  'cloudforge_approve_review_finding',
  'cloudforge_dismiss_change_request',
  'cloudforge_approve_pull_request',
];
const toolNames = async (t: TestEnv, token: string) =>
  (
    (await (await rpc(t, token, 'tools/list')).json()) as {
      result: { tools: { name: string }[] };
    }
  ).result.tools.map((x) => x.name);
const pullArgs = (extra: Record<string, unknown> = {}) => ({
  repository: 'octocat/app',
  number: 1,
  ...extra,
});
const getPull = async (t: TestEnv, token: string) =>
  JSON.parse(
    (await tool(t, token, 'cloudforge_get_pull_request', pullArgs())).content[0]
      .text
  ) as {
    state: string;
    reasons: { kind: string }[];
    approved_by: string[];
    approvals: { user: string | null; via: string | null }[];
    merged: { automatically: boolean } | null;
    reviewers: {
      findings: { id: string; state: string; via: string | null }[];
    }[];
  };
const nothingDecided = async (t: TestEnv, ...ids: string[]) => {
  for (const id of ids)
    expect(await flagRow(t, id)).toMatchObject({
      approved_at: null,
      approved_via: null,
    });
  expect(await approvalRows(t)).toEqual([]);
  expect(await approvedEvents(t)).toEqual([]);
};

/** reviewed(), plus two apps for octocat: "Claude Mod" (a moderator) and "Claude Code" (not). */
async function moderated() {
  const r = await reviewed();
  const mod = await connect(r.t, r.admin, 'Claude Mod');
  const coder = await connect(r.t, r.admin, 'Claude Code');
  expect((await setModerator(r.t, r.admin, mod.clientId, true)).status).toBe(
    200
  );
  return {
    ...r,
    mod: mod.access_token,
    modClient: mod.clientId,
    coder: coder.access_token,
  };
}

describe('审核工具', () => {
  it('仅向具有审核权限的连接列出并说明这些工具', async () => {
    const { t, admin, mod, coder } = await moderated();
    const modTools = await toolNames(t, mod);
    const coderTools = await toolNames(t, coder);
    expect(modTools).toEqual(expect.arrayContaining(MOD_TOOLS));
    for (const name of MOD_TOOLS) expect(coderTools).not.toContain(name);
    // Requesting changes stays open to every connection.
    expect(coderTools).toContain('cloudforge_request_changes_on_review_flag');
    expect(modTools.length).toBe(coderTools.length + 3);

    const instructions = async (token: string) =>
      (
        (await (await rpc(t, token, 'initialize')).json()) as {
          result: { instructions: string };
        }
      ).result.instructions;
    expect(await instructions(mod)).toMatch(/This connection is a moderator/);
    expect(await instructions(coder)).not.toMatch(/moderator/);
    // A moderator isn't told, in the same breath, that only a person can approve.
    expect(await instructions(coder)).toMatch(/Only a person can approve/);
    expect(await instructions(mod)).not.toMatch(/Only a person can approve/);

    const page = (await (
      await call(t, '/api/mcp', { cookie: admin })
    ).json()) as { tools: unknown[]; moderatorTools: { name: string }[] };
    expect(page.tools).toHaveLength(29);
    expect(page.moderatorTools.map((x) => x.name)).toEqual(MOD_TOOLS);
  });

  it('拒绝其他连接调用且不写入记录', async () => {
    const { t, coder, head, person, change } = await moderated();
    for (const [name, extra] of [
      ['cloudforge_approve_review_finding', { finding_id: person.id }],
      ['cloudforge_dismiss_change_request', { finding_id: change.id }],
      ['cloudforge_approve_pull_request', {}],
    ] as const) {
      const res = await tool(
        t,
        coder,
        name,
        pullArgs({ ...extra, head_sha: head })
      );
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toBe(NOT_MODERATOR);
    }
    await nothingDecided(t, person.id, change.id);
  });

  it('每次调用都检查权限，关闭权限或断开连接立即生效', async () => {
    const { t, admin, mod, modClient, head, person } = await moderated();
    expect(await toolNames(t, mod)).toEqual(expect.arrayContaining(MOD_TOOLS));
    // Off: the same token loses the tools on its very next call.
    await setModerator(t, admin, modClient, false);
    for (const name of MOD_TOOLS)
      expect(await toolNames(t, mod)).not.toContain(name);
    const refused = await tool(
      t,
      mod,
      'cloudforge_approve_review_finding',
      pullArgs({ finding_id: person.id, head_sha: head })
    );
    expect(refused.content[0].text).toBe(NOT_MODERATOR);
    await nothingDecided(t, person.id);
    // On again: works on the next call.
    await setModerator(t, admin, modClient, true);
    const ok = await tool(
      t,
      mod,
      'cloudforge_approve_review_finding',
      pullArgs({ finding_id: person.id, head_sha: head })
    );
    expect(ok.isError).toBeFalsy();
    // Disconnected: the token stops working at all.
    await call(t, `/api/mcp/connections/${encodeURIComponent(modClient)}`, {
      cookie: admin,
      method: 'DELETE',
    });
    expect((await rpc(t, mod, 'tools/list')).status).toBe(401);
    await settle(t);
  });

  it('与网页一致，批准受保护代理的审查意见时必须提供理由', async () => {
    const { t, mod, head, person } = await moderated();
    await t.env.DB.prepare(
      "UPDATE agents SET guarded = 1, facet = 'security'"
    ).run();
    const refused = await tool(
      t,
      mod,
      'cloudforge_approve_review_finding',
      pullArgs({ finding_id: person.id, head_sha: head })
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/needs a reason/);
    await nothingDecided(t, person.id);
    const ok = await tool(
      t,
      mod,
      'cloudforge_approve_review_finding',
      pullArgs({
        finding_id: person.id,
        head_sha: head,
        reason: 'Accepted risk: the export is internal.',
      })
    );
    expect(ok.isError).toBeFalsy();
    expect(await flagRow(t, person.id)).toMatchObject({
      approved_via: 'Claude Mod',
    });
    const row = await t.env.DB.prepare(
      'SELECT decision_reason FROM pr_review_flags WHERE id = ?'
    )
      .bind(person.id)
      .first<{ decision_reason: string }>();
    expect(row!.decision_reason).toBe('Accepted risk: the export is internal.');
    await settle(t);
  });

  it('与网页一致，代表用户批准审查意见并记录应用来源', async () => {
    const { t, mod, head, person } = await moderated();
    const res = await tool(
      t,
      mod,
      'cloudforge_approve_review_finding',
      pullArgs({ finding_id: person.id, head_sha: head })
    );
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/octocat\/app\/pull\/1/);
    expect(await flagRow(t, person.id)).toMatchObject({
      approved_by_id: await userId(t),
      approved_via: 'Claude Mod',
    });
    await settle(t);
    const got = await getPull(t, mod);
    expect(got.reviewers[0].findings[0]).toMatchObject({
      id: person.id,
      state: 'approved',
      via: 'Claude Mod',
    });
    expect(got.reviewers[0].findings[1]).toMatchObject({ via: null });
    const kinds = got.reasons.map((r) => r.kind);
    expect(kinds).not.toContain('agent_flagged');
    // The agent's change request still holds the pull request.
    expect(kinds).toContain('agent_changes_requested');
    expect(got.state).toBe('open');
  });

  it('驳回代理的修改请求后，拉取请求按网页操作相同的规则合入', async () => {
    const { t, mod, head, person, change } = await moderated();
    for (const [name, id] of [
      ['cloudforge_approve_review_finding', person.id],
      ['cloudforge_dismiss_change_request', change.id],
    ] as const) {
      const res = await tool(
        t,
        mod,
        name,
        pullArgs({ finding_id: id, head_sha: head })
      );
      expect(res.isError).toBeFalsy();
    }
    expect((await flagRow(t, change.id))!.approved_via).toBe('Claude Mod');
    await settle(t);
    const got = await getPull(t, mod);
    expect(got).toMatchObject({
      state: 'merged',
      merged: { automatically: true },
    });
  });

  it('允许覆盖需人工处理的意见以批准拉取请求，但不能覆盖修改请求', async () => {
    const { t, mod, head, change } = await moderated();
    const res = await tool(
      t,
      mod,
      'cloudforge_approve_pull_request',
      pullArgs({ head_sha: head })
    );
    expect(res.isError).toBeFalsy();
    expect(await approvalRows(t)).toMatchObject([
      { head_sha: head, via: 'Claude Mod' },
    ]);
    expect(await approvedEvents(t)).toMatchObject([
      { head_sha: head, via: 'Claude Mod' },
    ]);
    await settle(t);
    let got = await getPull(t, mod);
    expect(got.approved_by).toEqual(['octocat']);
    expect(got.approvals).toEqual([{ user: 'octocat', via: 'Claude Mod' }]);
    expect(got.reasons.map((r) => r.kind)).not.toContain('agent_flagged');
    expect(got.reasons.map((r) => r.kind)).toContain('agent_changes_requested');
    expect(got.state).toBe('open');
    // Dismissing the change request lets the approval count: auto-merge lands it.
    await tool(
      t,
      mod,
      'cloudforge_dismiss_change_request',
      pullArgs({ finding_id: change.id, head_sha: head })
    );
    await settle(t);
    got = await getPull(t, mod);
    expect(got).toMatchObject({ state: 'merged' });
  });

  it('审核应用查看后拉取请求发生变化时不写入记录', async () => {
    const { t, mod, repo, head, person, change } = await moderated();
    await commitPaths(
      repo,
      'feature',
      {
        'src/app.ts': 'export const a = 1;\n',
        'src/a.ts': 'export const answer = 1;\n',
      },
      'Rename'
    );
    for (const [name, extra] of [
      ['cloudforge_approve_review_finding', { finding_id: person.id }],
      ['cloudforge_dismiss_change_request', { finding_id: change.id }],
      ['cloudforge_approve_pull_request', {}],
    ] as const) {
      const res = await tool(
        t,
        mod,
        name,
        pullArgs({ ...extra, head_sha: head })
      );
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/new commits since you looked/);
    }
    await nothingDecided(t, person.id, change.id);
  });

  it('要求完整 head_sha，不接受缩写', async () => {
    const { t, mod, head, person, change } = await moderated();
    for (const sha of [head.slice(0, 7), `${head.slice(0, 39)}z`, 'main']) {
      const res = await tool(
        t,
        mod,
        'cloudforge_approve_review_finding',
        pullArgs({ finding_id: person.id, head_sha: sha })
      );
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/full 40-character head_sha/);
    }
    // And head_sha is required.
    const missing = await tool(
      t,
      mod,
      'cloudforge_approve_pull_request',
      pullArgs()
    );
    expect(missing.content[0].text).toBe('head_sha is required.');
    await nothingDecided(t, person.id, change.id);
  });

  it('拒绝类型错误的审查意见', async () => {
    const { t, mod, head, person, change } = await moderated();
    const approveChange = await tool(
      t,
      mod,
      'cloudforge_approve_review_finding',
      pullArgs({ finding_id: change.id, head_sha: head })
    );
    expect(approveChange.isError).toBe(true);
    expect(approveChange.content[0].text).toMatch(/change request/);
    const dismissPerson = await tool(
      t,
      mod,
      'cloudforge_dismiss_change_request',
      pullArgs({ finding_id: person.id, head_sha: head })
    );
    expect(dismissPerson.isError).toBe(true);
    expect(dismissPerson.content[0].text).toMatch(/approval/);
    const unknown = await tool(
      t,
      mod,
      'cloudforge_approve_review_finding',
      pullArgs({ finding_id: 'nope', head_sha: head })
    );
    expect(unknown.content[0].text).toMatch(/has no finding nope/);
    await nothingDecided(t, person.id, change.id);
  });

  it('仍要求推送权限，审核应用使用所属用户的权限', async () => {
    const { t, admin, head, person, change } = await moderated();
    // bob can read octocat/app (internal) but not push.
    const bob = await addMember(t, admin, 'bob');
    const bobs = await connect(t, bob, 'Bob Mod');
    expect((await setModerator(t, bob, bobs.clientId, true)).status).toBe(200);
    expect(await toolNames(t, bobs.access_token)).toEqual(
      expect.arrayContaining(MOD_TOOLS)
    );
    for (const [name, extra] of [
      ['cloudforge_approve_review_finding', { finding_id: person.id }],
      ['cloudforge_dismiss_change_request', { finding_id: change.id }],
      ['cloudforge_approve_pull_request', {}],
    ] as const) {
      const res = await tool(
        t,
        bobs.access_token,
        name,
        pullArgs({ ...extra, head_sha: head })
      );
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/permission/);
    }
    await nothingDecided(t, person.id, change.id);
  });

  it('处理器也拒绝没有审核权限的调用', async () => {
    const { t, head, person, change } = await moderated();
    const { db } = await target(t);
    const user = { id: await userId(t) };
    for (const module of MODERATOR_TOOLS) {
      const ctx = {
        db,
        env: t.env,
        user,
        baseURL: 'http://test.local',
        after: (w: Promise<unknown>) => t.ctx.waitUntil(w),
        moderator: null,
      } as unknown as ToolContext;
      await expect(
        module.handler(pullArgs({ finding_id: person.id, head_sha: head }), ctx)
      ).rejects.toThrow(NOT_MODERATOR);
    }
    await nothingDecided(t, person.id, change.id);
  });
});

/** An authorization request for `clientId`, as an MCP client sends it. */
async function authorizeParams(
  clientId: string,
  extra: Record<string, string> = {}
) {
  const { challenge } = await pkce();
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'openid profile email offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${ORIGIN}/mcp`,
    ...extra,
  });
}
/** Where /oauth2/authorize sends the signed-in user: the consent page, or straight back with a code. */
async function authorizeTo(
  t: TestEnv,
  cookie: string,
  clientId: string,
  extra: Record<string, string> = {}
) {
  const res = await raw(
    t,
    `/api/auth/oauth2/authorize?${await authorizeParams(clientId, extra)}`,
    { headers: { Cookie: cookie }, redirect: 'manual' }
  );
  expect(res.status).toBe(302);
  return new URL(res.headers.get('Location')!, ORIGIN);
}
const consentIds = async (t: TestEnv) =>
  (
    await t.env.DB.prepare(
      'SELECT id, client_id FROM oauth_consents ORDER BY client_id'
    ).all<{ id: string; client_id: string }>()
  ).results;

describe('重新授权审核应用', () => {
  it('始终显示授权页面，并在同意时保留原授权及审核权限', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const mod = await connect(t, admin, 'Claude Mod');
    await setModerator(t, admin, mod.clientId, true);
    const before = await consentIds(t);

    const consentUrl = await authorizeTo(t, admin, mod.clientId);
    expect(consentUrl.pathname).toBe('/oauth/consent');
    expect(consentUrl.searchParams.get('code')).toBeNull();

    // Consenting there issues the code, once, under the same consent.
    const consent = await call(t, '/api/auth/oauth2/consent', {
      cookie: admin,
      json: { accept: true, oauth_query: consentUrl.search.slice(1) },
    });
    expect(consent.status).toBe(200);
    const { url } = (await consent.json()) as { url: string };
    expect(url.startsWith(REDIRECT)).toBe(true);
    expect(new URL(url).searchParams.get('code')).toBeTruthy();
    expect(await consentIds(t)).toEqual(before);
    expect((await apps(t, admin))[0].moderator).toBe(true);
  });

  it('普通应用沿用已有授权，直接签发授权码', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const coder = await connect(t, admin, 'Claude Code');
    const back = await authorizeTo(t, admin, coder.clientId);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get('code')).toBeTruthy();
  });

  it('登录后也显示授权页面，并支持表单提交', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const mod = await connect(t, admin, 'Claude Mod');
    await setModerator(t, admin, mod.clientId, true);

    // Signed out: login, then the sign-in response continues to consent, not to the app.
    const res = await raw(
      t,
      `/api/auth/oauth2/authorize?${await authorizeParams(mod.clientId)}`,
      { redirect: 'manual' }
    );
    const login = new URL(res.headers.get('Location')!, ORIGIN);
    expect(login.pathname).toBe('/login');
    const signIn = await call(t, '/api/auth/sign-in/username', {
      json: {
        username: 'octocat',
        password: 'password123',
        oauth_query: login.search.slice(1),
      },
    });
    expect(signIn.status).toBe(200);
    const body = (await signIn.json()) as { url?: string };
    expect(new URL(body.url!, ORIGIN).pathname).toBe('/oauth/consent');

    // POST /oauth2/authorize reads the form body, not the query.
    const post = await raw(t, '/api/auth/oauth2/authorize', {
      method: 'POST',
      headers: {
        Cookie: admin,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: ORIGIN,
      },
      body: await authorizeParams(mod.clientId),
      redirect: 'manual',
    });
    expect(post.status).toBe(302);
    expect(new URL(post.headers.get('Location')!, ORIGIN).pathname).toBe(
      '/oauth/consent'
    );
  });

  it('即使请求 prompt=none，也不静默签发授权码', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const mod = await connect(t, admin, 'Claude Mod');
    await setModerator(t, admin, mod.clientId, true);
    const back = await authorizeTo(t, admin, mod.clientId, { prompt: 'none' });
    expect(back.searchParams.get('code')).toBeNull();
    expect(back.searchParams.get('error')).toBeTruthy();
  });
});
