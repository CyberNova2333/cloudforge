import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import {
  bootstrapAdmin,
  addMember,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';
import {
  connect,
  register,
  pkce,
  raw,
  ORIGIN,
  REDIRECT,
  rpc,
} from '../helpers/mcp';
import { readPolicy } from '../../auth/policy';
import { handleGitRequest } from '../../git/http/handler';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
});
afterEach(() => vi.useRealTimers());
const base = '/api/admin/authentication-policy';
function cookies(res: Response) {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
async function setup() {
  const t = makeEnv();
  let cookie = await bootstrapAdmin(t);
  const begin = await call(t, '/api/auth/two-factor/enable', {
    cookie,
    json: { password: 'password123' },
  });
  expect(begin.status).toBe(200);
  const enrolled = (await begin.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const otp = createOTP(
    new TextDecoder().decode(
      base32.decode(new URL(enrolled.totpURI).searchParams.get('secret')!)
    )
  );
  const confirmed = await call(t, '/api/auth/two-factor/verify-totp', {
    cookie,
    json: { code: await otp.totp() },
  });
  expect(confirmed.status).toBe(200);
  cookie = cookies(confirmed);
  const identity = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { session: { id: string }; user: { id: string } };
  return {
    t,
    cookie,
    sessionId: identity.session.id,
    userId: identity.user.id,
    otp,
    ...enrolled,
  };
}
type Preview = {
  previewId: string;
  digest: string;
  impact: Record<string, number>;
};
async function preview(t: TestEnv, cookie: string, requireMfa = true) {
  const response = await call(t, `${base}/preview`, {
    cookie,
    json: { requireMfa },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Preview;
}
const apply = (t: TestEnv, cookie: string, p: Preview) =>
  call(t, `${base}/apply`, {
    cookie,
    json: {
      previewId: p.previewId,
      digest: p.digest,
      recoveryAcknowledged: true,
    },
  });

describe('管理员强制MFA策略的预览与原子提交', () => {
  it('预览明确列出机器凭据豁免，策略变更后既有Git凭据仍按原权限使用', async () => {
    const { t, cookie } = await setup();
    expect(
      (
        await call(t, '/api/repos', {
          cookie,
          json: { name: 'app', addReadme: true },
        })
      ).status
    ).toBe(201);
    const pat = (await (
      await call(t, '/api/tokens', { cookie, json: { name: 'existing-ci' } })
    ).json()) as { plaintext: string };
    const deploy = (await (
      await call(t, '/api/repos/octocat/app/deploy-tokens', {
        cookie,
        json: { name: 'existing-deploy' },
      })
    ).json()) as { plaintext: string };
    const p = await preview(t, cookie);
    expect(p.impact).toMatchObject({ personalTokens: 1, deployTokens: 1 });
    expect((await apply(t, cookie, p)).status).toBe(200);
    for (const token of [pat.plaintext, deploy.plaintext]) {
      const response = await handleGitRequest(
        new Request(
          'http://test.local/octocat/app.git/info/refs?service=git-upload-pack',
          {
            headers: { Authorization: `Basic ${btoa(`git:${token}`)}` },
          }
        ),
        t.env,
        t.ctx
      );
      expect(
        response.status,
        response.ok ? undefined : await response.clone().text()
      ).toBe(200);
      await response.arrayBuffer();
    }
    expect(
      (
        await call(t, '/api/admin/authentication-policy', {
          headers: { Authorization: `Bearer ${pat.plaintext}` },
        })
      ).status
    ).toBe(401);
  });
  it('两位管理员并发提交仅一份预览成功，旧计划不能再次推进版本', async () => {
    const { t, cookie } = await setup();
    const other = await addMember(t, cookie, 'other');
    const user = await t.env.DB.prepare(
      "SELECT id FROM users WHERE username='other'"
    ).first<{ id: string }>();
    expect(
      (
        await call(t, '/api/auth/admin/set-role', {
          cookie,
          json: { userId: user!.id, role: 'admin' },
        })
      ).status
    ).toBe(200);
    const start = await call(t, '/api/auth/two-factor/enable', {
      cookie: other,
      json: { password: 'password123' },
    });
    const data = (await start.json()) as { totpURI: string };
    const otp = createOTP(
      new TextDecoder().decode(
        base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
      )
    );
    const confirmation = await call(t, '/api/auth/two-factor/verify-totp', {
      cookie: other,
      json: { code: await otp.totp() },
    });
    expect(confirmation.status).toBe(200);
    const second = cookies(confirmation);
    const [firstPreview, secondPreview] = await Promise.all([
      preview(t, cookie),
      preview(t, second),
    ]);
    const responses = await Promise.all([
      apply(t, cookie, firstPreview),
      apply(t, second, secondPreview),
    ]);
    expect(
      responses.filter((response) => response.status === 200)
    ).toHaveLength(1);
    expect(responses.filter((response) => response.status >= 400)).toHaveLength(
      1
    );
    expect(await readPolicy(t.env)).toEqual({ version: 1, requireMfa: true });
    expect(
      await t.env.DB.prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='instance.authentication_policy'"
      ).first()
    ).toEqual({ n: 1 });
  });
  it('默认不改变原会话，未绑定管理员也不能跳过强因子启用策略', async () => {
    const t = makeEnv(),
      cookie = await bootstrapAdmin(t);
    expect(await readPolicy(t.env)).toEqual({ version: 0, requireMfa: false });
    expect(
      await (await call(t, '/api/me/authentication-policy', { cookie })).json()
    ).toMatchObject({
      access: 'full',
      policy: { version: 0, requireMfa: false },
    });
    const response = await call(t, `${base}/preview`, {
      cookie,
      json: { requireMfa: true },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'MFA_ENROLLMENT_REQUIRED',
    });
    expect(
      (
        await call(t, '/api/admin/settings/authentication.require_mfa', {
          method: 'PUT',
          cookie,
          json: { value: true },
        })
      ).status
    ).toBe(404);
  });
  it('一次确认完成版本推进、当前管理员迁移、OAuth撤权和审计，重放无效', async () => {
    const { t, cookie, sessionId } = await setup();
    const old = await connect(t, cookie);
    const p = await preview(t, cookie);
    expect(p.impact).toMatchObject({
      members: 1,
      unenrolledMembers: 0,
      oauthConnections: 1,
    });
    const noAck = await call(t, `${base}/apply`, {
      cookie,
      json: {
        previewId: p.previewId,
        digest: p.digest,
        recoveryAcknowledged: false,
      },
    });
    expect(noAck.status).toBe(400);
    expect((await apply(t, cookie, p)).status).toBe(200);
    expect(await readPolicy(t.env)).toEqual({ version: 1, requireMfa: true });
    expect(
      await (await call(t, '/api/me/authentication-policy', { cookie })).json()
    ).toMatchObject({
      sessionId,
      access: 'full',
      policy: { version: 1, requireMfa: true },
    });
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(401);
    expect((await apply(t, cookie, p)).status).toBe(409);
    const audits = await t.env.DB.prepare(
      "SELECT data FROM audit_events WHERE action='instance.authentication_policy'"
    ).all<{ data: string }>();
    expect(audits.results).toHaveLength(1);
    expect(JSON.parse(audits.results[0].data)).toEqual({
      version: 1,
      requireMfa: true,
    });
    expect(JSON.stringify(audits.results)).not.toContain('password123');
  });
  it('未绑定成员仅保留绑定和退出，公开仓库读按匿名权限处理', async () => {
    const { t, cookie } = await setup();
    const member = await addMember(t, cookie, 'member');
    for (const visibility of ['private', 'internal', 'public'])
      await call(t, '/api/repos', {
        cookie,
        json: { name: visibility, visibility },
      });
    expect((await apply(t, cookie, await preview(t, cookie))).status).toBe(200);
    expect(
      await (
        await call(t, '/api/me/authentication-policy', { cookie: member })
      ).json()
    ).toMatchObject({ access: 'enroll_mfa' });
    for (const path of [
      '/api/users',
      '/api/notifications',
      '/api/live',
      '/api/admin/settings',
    ])
      expect((await call(t, path, { cookie: member })).status, path).toBe(403);
    expect(
      (
        await call(t, '/api/tokens', {
          cookie: member,
          json: { name: 'blocked' },
        })
      ).status
    ).toBe(403);
    expect(
      (await call(t, '/api/repos/octocat/internal', { cookie: member })).status
    ).toBe(404);
    expect(
      (await call(t, '/api/repos/octocat/public', { cookie: member })).status
    ).toBe(200);
    expect(
      (await call(t, '/api/auth/get-session', { cookie: member })).status
    ).toBe(200);
    expect(
      (await call(t, '/api/auth/sign-out', { cookie: member, json: {} })).status
    ).toBe(200);
  });
  for (const mutation of [
    '过期',
    '影响人数变化',
    '恢复码组变化',
    '证明变化',
    '新预览替换',
  ])
    it(`拒绝${mutation}后的旧预览，零行CAS不会撤权或审计`, async () => {
      const { t, cookie, sessionId, userId } = await setup();
      const old = await connect(t, cookie);
      const p = await preview(t, cookie);
      if (mutation === '过期')
        await t.env.DB.prepare(
          'UPDATE authentication_policy_previews SET expires_at=?'
        )
          .bind(Date.now() - 1)
          .run();
      else if (mutation === '影响人数变化') await addMember(t, cookie, 'later');
      else if (mutation === '恢复码组变化')
        await t.env.DB.prepare(
          'UPDATE two_factors SET recovery_version=recovery_version+1 WHERE user_id=?'
        )
          .bind(userId)
          .run();
      else if (mutation === '证明变化')
        await t.env.DB.prepare(
          'UPDATE sessions SET auth_time=auth_time-1 WHERE id=?'
        )
          .bind(sessionId)
          .run();
      else await preview(t, cookie);
      expect((await apply(t, cookie, p)).status).toBe(409);
      expect(await readPolicy(t.env)).toEqual({
        version: 0,
        requireMfa: false,
      });
      expect((await rpc(t, old.access_token, 'ping')).status).toBe(200);
      expect(
        await t.env.DB.prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action='instance.authentication_policy'"
        ).first()
      ).toEqual({ n: 0 });
    });
  it('审计写入失败时策略、预览消费、会话迁移与OAuth删除一起回滚', async () => {
    const { t, cookie, sessionId } = await setup();
    const old = await connect(t, cookie);
    const p = await preview(t, cookie);
    await t.env.DB.prepare(
      "CREATE TRIGGER test_policy_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='instance.authentication_policy' BEGIN SELECT RAISE(ABORT,'injected policy audit failure'); END"
    ).run();
    try {
      expect((await apply(t, cookie, p)).status).toBe(500);
      expect(await readPolicy(t.env)).toEqual({
        version: 0,
        requireMfa: false,
      });
      expect(
        await t.env.DB.prepare('SELECT policy_version FROM sessions WHERE id=?')
          .bind(sessionId)
          .first()
      ).toEqual({ policy_version: 0 });
      expect(
        await t.env.DB.prepare(
          'SELECT used_at FROM authentication_policy_previews WHERE id=?'
        )
          .bind(p.previewId)
          .first()
      ).toEqual({ used_at: null });
      expect((await rpc(t, old.access_token, 'ping')).status).toBe(200);
    } finally {
      await t.env.DB.prepare('DROP TRIGGER test_policy_audit_failure').run();
    }
  });
  it('受限成员仍能拒绝策略切换前打开的签名OAuth请求', async () => {
    const { t, cookie } = await setup();
    const member = await addMember(t, cookie, 'member');
    const clientId = await register(t);
    const { challenge } = await pkce();
    const start = await raw(
      t,
      `/api/auth/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'openid', code_challenge: challenge, code_challenge_method: 'S256', resource: `${ORIGIN}/mcp` })}`,
      { headers: { cookie: member }, redirect: 'manual' }
    );
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location')!, ORIGIN);
    expect(location.pathname).toBe('/oauth/consent');
    expect((await apply(t, cookie, await preview(t, cookie))).status).toBe(200);
    const denied = await call(t, '/api/auth/oauth2/consent', {
      cookie: member,
      json: { accept: false, oauth_query: location.search.slice(1) },
    });
    expect(denied.status).toBe(200);
    const body = (await denied.json()) as { url: string };
    expect(new URL(body.url).searchParams.get('error')).toBe('access_denied');
  });
});
