import { describe, expect, it } from 'vitest';
import {
  durableSessionAssurance,
  hasOidcOrigin,
  readSessionAuthentication,
} from '../../auth/assurance';
import { evaluatePolicyAccess } from '../../auth/policy';
import { bootstrapAdmin, call, makeEnv } from '../helpers/app';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { app } from '../../index';

function responseCookies(response: Response) {
  const jar = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0];
    jar.set(pair.slice(0, pair.indexOf('=')), pair);
  }
  return [...jar.values()].join('; ');
}

const origin = {
  oidcBindingId: 'fixture-binding',
  oidcBindingRevision: 1,
  oidcConfigurationGeneration: 1,
};

describe('外部登录来源与本地密码证明分离', () => {
  it('外部主证明及真实本地因子不冒充密码，后续密码重验也不清来源', () => {
    const time = Date.now() - 1000;
    expect(
      durableSessionAssurance({ ...origin, authMethod: 'oidc', authTime: time })
    ).toEqual({
      strength: 'oidc',
      primary: { method: 'oidc', verifiedAt: new Date(time).toISOString() },
      secondFactor: null,
      source: { method: 'oidc' },
    });
    const factor = { secondFactorMethod: 'totp', secondFactorTime: time };
    expect(
      durableSessionAssurance({
        ...origin,
        ...factor,
        authMethod: 'oidc',
        authTime: time,
      })
    ).toMatchObject({ strength: 'multi_factor', primary: { method: 'oidc' } });
    expect(
      durableSessionAssurance({
        ...origin,
        ...factor,
        authMethod: 'password',
        authTime: time,
      })
    ).toMatchObject({
      strength: 'multi_factor',
      primary: { method: 'password' },
      source: { method: 'oidc' },
    });
  });

  it.each([
    {},
    { oidcBindingId: 'id' },
    { ...origin, oidcBindingRevision: 0 },
    { ...origin, oidcConfigurationGeneration: null },
    { ...origin, oidcBindingId: '' },
  ])('缺失或不完整来源不能形成有效外部证明：%j', (source) => {
    const record = {
      ...source,
      authMethod: 'oidc',
      authTime: Date.now() - 1000,
      policyVersion: 1,
      secondFactorMethod: 'totp',
      secondFactorTime: Date.now() - 1000,
    };
    expect(hasOidcOrigin(record)).toBe(false);
    expect(durableSessionAssurance(record).strength).toBe('unknown');
    expect(
      evaluatePolicyAccess(record, true, { requireMfa: false, version: 1 })
    ).toBe('reauthenticate');
    expect(
      evaluatePolicyAccess(record, true, { requireMfa: true, version: 1 })
    ).toBe('reauthenticate');
  });

  it('强制策略接受实际外部主因子与本地因子，不接受IdP字符串或缺因子', () => {
    const record = {
      ...origin,
      policyVersion: 3,
      authMethod: 'oidc',
      authTime: Date.now() - 1000,
      secondFactorMethod: 'recovery_code',
      secondFactorTime: Date.now() - 1000,
    };
    expect(
      evaluatePolicyAccess(record, true, { version: 3, requireMfa: true })
    ).toBe('full');
    expect(
      evaluatePolicyAccess({ ...record, secondFactorMethod: 'idp_amr' }, true, {
        version: 3,
        requireMfa: true,
      })
    ).toBe('reauthenticate');
    expect(
      evaluatePolicyAccess({ ...record, secondFactorTime: null }, true, {
        version: 3,
        requireMfa: true,
      })
    ).toBe('reauthenticate');
    expect(
      evaluatePolicyAccess(record, false, { version: 3, requireMfa: true })
    ).toBe('enroll_mfa');
    expect(
      evaluatePolicyAccess(record, true, { version: 4, requireMfa: true })
    ).toBe('reauthenticate');
  });
});

/** A real signed native cookie and D1 rows, then a source fixture; this tests reads, not SSO issuance. */
async function sourcedSession() {
  const t = makeEnv(),
    cookie = await bootstrapAdmin(t);
  const native = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { session: { id: string }; user: { id: string } };
  const bindingId = crypto.randomUUID(),
    providerId = 'source-fixture',
    issuer = 'https://identity.example/source';
  const now = Date.now();
  await t.env.DB.batch([
    t.env.DB.prepare(
      'INSERT INTO oidc_providers (id,issuer,version,digest,created_at) VALUES (?,?,1,?,?)'
    ).bind(providerId, issuer, 'fixture-digest', now),
    t.env.DB.prepare(
      'INSERT INTO oidc_configuration (id,enabled,login_enabled,provider_id,version,digest,generation,action_id,updated_at) VALUES (1,1,1,?,1,?,1,?,?)'
    ).bind(providerId, 'fixture-digest', crypto.randomUUID(), now),
    t.env.DB.prepare(
      'INSERT INTO oidc_bindings (id,provider_id,issuer,subject,user_id,active,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?)'
    ).bind(
      bindingId,
      providerId,
      issuer,
      crypto.randomUUID(),
      native.user.id,
      now,
      now
    ),
    t.env.DB.prepare(
      "UPDATE sessions SET oidc_binding_id=?,oidc_binding_revision=1,oidc_configuration_generation=1,auth_method='oidc',auth_time=? WHERE id=?"
    ).bind(bindingId, now, native.session.id),
  ]);
  return {
    t,
    cookie,
    bindingId,
    sessionId: native.session.id,
    userId: native.user.id,
  };
}

describe('SSO来源的真实D1读取与撤权', () => {
  it.each([
    [
      '清空全部来源并改记密码',
      "oidc_binding_id=NULL,oidc_binding_revision=NULL,oidc_configuration_generation=NULL,auth_method='password'",
    ],
    ['替换绑定', "oidc_binding_id='replacement-binding'"],
    ['更换绑定代数', 'oidc_binding_revision=2'],
    ['更换配置代数', 'oidc_configuration_generation=2'],
  ])('真实D1拒绝%s，整条更新回滚且原会话仍有效', async (_, change) => {
    const f = await sourcedSession();
    // Use an existing binding so a foreign-key failure cannot stand in for the source guard.
    await f.t.env.DB.prepare(
      "INSERT INTO oidc_bindings (id,provider_id,issuer,subject,user_id,active,revision,created_at,updated_at) SELECT 'replacement-binding',provider_id,issuer,'replacement-subject',user_id,0,1,created_at,updated_at FROM oidc_bindings WHERE id=?"
    )
      .bind(f.bindingId)
      .run();
    const read = () =>
      f.t.env.DB.prepare(
        'SELECT id,oidc_binding_id,oidc_binding_revision,oidc_configuration_generation,auth_method,auth_time FROM sessions WHERE id=?'
      )
        .bind(f.sessionId)
        .first();
    const before = await read();
    expect(before).toMatchObject({
      oidc_binding_id: f.bindingId,
      oidc_binding_revision: 1,
      oidc_configuration_generation: 1,
      auth_method: 'oidc',
    });
    expect(
      await f.t.env.DB.prepare(
        'UPDATE sessions SET oidc_binding_id=oidc_binding_id,oidc_binding_revision=oidc_binding_revision,oidc_configuration_generation=oidc_configuration_generation WHERE id=? RETURNING id'
      )
        .bind(f.sessionId)
        .first()
    ).toEqual({ id: f.sessionId });
    await expect(
      f.t.env.DB.prepare(`UPDATE sessions SET ${change} WHERE id=?`)
        .bind(f.sessionId)
        .run()
    ).rejects.toThrow('OIDC session source is immutable');
    expect(await read()).toEqual(before);
    expect(await readSessionAuthentication(f.t.env, f.sessionId)).toMatchObject(
      {
        authMethod: 'oidc',
        oidcBindingId: f.bindingId,
        oidcBindingRevision: 1,
        oidcConfigurationGeneration: 1,
      }
    );
    expect(
      (await call(f.t, '/api/me/authentication', { cookie: f.cookie })).status
    ).toBe(200);
    expect(
      await (
        await call(f.t, '/api/auth/get-session', { cookie: f.cookie })
      ).json()
    ).toMatchObject({ session: { id: f.sessionId } });
  });

  it('非法百分号编码的站内回跳安全返回400，不变成原生500', async () => {
    const t = makeEnv();
    Object.assign(t.env, { BASE_URL: 'https://test.local' });
    // The generic call helper intentionally forces http://test.local; exercise the real HTTPS origin here.
    const response = await app.fetch(
      new Request('https://test.local/api/auth/oidc-sign-in/start', {
        method: 'POST',
        headers: {
          Origin: 'https://test.local',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.55',
        },
        body: JSON.stringify({ returnTo: '/%ZZ' }),
      }),
      t.env,
      t.ctx
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'OIDC_RETURN_TO_INVALID',
    });
  });
  it.each([null, 'email_verification'])(
    '有来源但主证明%s不能在策略关闭时变成业务会话',
    async (method) => {
      const f = await sourcedSession();
      await f.t.env.DB.prepare('UPDATE sessions SET auth_method=? WHERE id=?')
        .bind(method, f.sessionId)
        .run();
      expect(await readSessionAuthentication(f.t.env, f.sessionId)).toBeNull();
      expect(
        (await call(f.t, '/api/me/authentication', { cookie: f.cookie })).status
      ).toBe(401);
      expect(
        await (
          await call(f.t, '/api/auth/get-session', { cookie: f.cookie })
        ).json()
      ).toBeNull();
      expect(
        evaluatePolicyAccess(
          { ...origin, authMethod: method, policyVersion: 0 },
          false,
          { version: 0, requireMfa: false }
        )
      ).toBe('reauthenticate');
    }
  );
  it('真实本地密码重验后的SSO来源也不能通过模拟他人清掉来源约束', async () => {
    const f = await sourcedSession();
    const reauth = await call(f.t, '/api/auth/reauthenticate', {
      cookie: f.cookie,
      json: { sessionId: f.sessionId, password: 'password123' },
    });
    expect(reauth.status).toBe(200);
    const response = await call(f.t, '/api/auth/admin/impersonate-user', {
      cookie: f.cookie,
      json: { userId: f.userId },
      headers: { 'X-CloudForge-Session': f.sessionId },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'SSO_SOURCE_IMPERSONATION_FORBIDDEN',
    });
  });

  it('真实修改密码替换会话仍保留来源，解绑能撤销替换后的cookie', async () => {
    const f = await sourcedSession();
    expect(
      (
        await call(f.t, '/api/auth/reauthenticate', {
          cookie: f.cookie,
          json: { sessionId: f.sessionId, password: 'password123' },
        })
      ).status
    ).toBe(200);
    const changed = await call(f.t, '/api/auth/change-password', {
      cookie: f.cookie,
      json: {
        currentPassword: 'password123',
        newPassword: 'source-password-456',
        revokeOtherSessions: true,
      },
      headers: { 'X-CloudForge-Session': f.sessionId },
    });
    expect(changed.status).toBe(200);
    const cookie = responseCookies(changed);
    const next = (await (
      await call(f.t, '/api/auth/get-session', { cookie })
    ).json()) as { session: { id: string } };
    expect(next.session.id).not.toBe(f.sessionId);
    expect(
      await readSessionAuthentication(f.t.env, next.session.id)
    ).toMatchObject({
      authMethod: 'password',
      oidcBindingId: f.bindingId,
      oidcBindingRevision: 1,
      oidcConfigurationGeneration: 1,
    });
    expect(
      (
        await call(f.t, '/api/me/oidc/revoke', {
          cookie,
          json: { bindingId: f.bindingId, revision: 1 },
          headers: { 'X-CloudForge-Session': next.session.id },
        })
      ).status
    ).toBe(200);
    expect(
      await readSessionAuthentication(f.t.env, next.session.id)
    ).toBeNull();
  });

  it('首次启用本地MFA的替换会话仍继承外部来源及实际本地因素', async () => {
    const f = await sourcedSession();
    expect(
      (
        await call(f.t, '/api/auth/reauthenticate', {
          cookie: f.cookie,
          json: { sessionId: f.sessionId, password: 'password123' },
        })
      ).status
    ).toBe(200);
    const begin = await call(f.t, '/api/auth/two-factor/enable', {
      cookie: f.cookie,
      json: { password: 'password123' },
      headers: { 'X-CloudForge-Session': f.sessionId },
    });
    expect(begin.status).toBe(200);
    const data = (await begin.json()) as { totpURI: string };
    const secret = new TextDecoder().decode(
      base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
    );
    const verify = await call(f.t, '/api/auth/two-factor/verify-totp', {
      cookie: f.cookie,
      json: { code: await createOTP(secret).totp() },
    });
    expect(verify.status).toBe(200);
    const cookie = responseCookies(verify);
    const next = (await (
      await call(f.t, '/api/auth/get-session', { cookie })
    ).json()) as { session: { id: string } };
    const live = await readSessionAuthentication(f.t.env, next.session.id);
    expect(live).toMatchObject({
      oidcBindingId: f.bindingId,
      oidcBindingRevision: 1,
      oidcConfigurationGeneration: 1,
      secondFactorMethod: 'totp',
    });
    expect(durableSessionAssurance(live!)).toMatchObject({
      strength: 'multi_factor',
      source: { method: 'oidc' },
    });
  });

  it('真实禁用MFA后的新会话保留来源，解绑同时撤销REST与SDK访问', async () => {
    const f = await sourcedSession();
    expect(
      (
        await call(f.t, '/api/auth/reauthenticate', {
          cookie: f.cookie,
          json: { sessionId: f.sessionId, password: 'password123' },
        })
      ).status
    ).toBe(200);
    const begin = await call(f.t, '/api/auth/two-factor/enable', {
      cookie: f.cookie,
      json: { password: 'password123' },
      headers: { 'X-CloudForge-Session': f.sessionId },
    });
    expect(begin.status).toBe(200);
    const data = (await begin.json()) as { totpURI: string };
    const secret = new TextDecoder().decode(
      base32.decode(new URL(data.totpURI).searchParams.get('secret')!)
    );
    const verify = await call(f.t, '/api/auth/two-factor/verify-totp', {
      cookie: f.cookie,
      json: { code: await createOTP(secret).totp() },
    });
    expect(verify.status).toBe(200);
    const enrolledCookie = responseCookies(verify);
    const enrolled = (await (
      await call(f.t, '/api/auth/get-session', { cookie: enrolledCookie })
    ).json()) as {
      session: { id: string };
      user: { twoFactorEnabled: boolean };
    };
    expect(enrolled.user.twoFactorEnabled).toBe(true);
    expect(
      await readSessionAuthentication(f.t.env, enrolled.session.id)
    ).toMatchObject({
      oidcBindingId: f.bindingId,
      secondFactorMethod: 'totp',
    });

    const disabled = await call(f.t, '/api/auth/two-factor/disable', {
      cookie: enrolledCookie,
      json: { password: 'password123' },
      headers: { 'X-CloudForge-Session': enrolled.session.id },
    });
    expect(disabled.status).toBe(200);
    const cookie = responseCookies(disabled);
    const next = (await (
      await call(f.t, '/api/auth/get-session', { cookie })
    ).json()) as {
      session: { id: string };
      user: { twoFactorEnabled: boolean };
    };
    expect(next.session.id).not.toBe(enrolled.session.id);
    expect(next.user.twoFactorEnabled).toBe(false);
    const live = await readSessionAuthentication(f.t.env, next.session.id);
    expect(live).toMatchObject({
      authMethod: 'password',
      secondFactorMethod: null,
      secondFactorTime: null,
      oidcBindingId: f.bindingId,
      oidcBindingRevision: 1,
      oidcConfigurationGeneration: 1,
    });
    expect(durableSessionAssurance(live!)).toMatchObject({
      strength: 'password',
      source: { method: 'oidc' },
    });
    expect(
      await (
        await call(f.t, '/api/auth/get-session', { cookie: enrolledCookie })
      ).json()
    ).toBeNull();
    expect(
      await f.t.env.DB.prepare('SELECT id FROM two_factors WHERE user_id=?')
        .bind(f.userId)
        .first()
    ).toBeNull();
    expect((await call(f.t, '/api/me/authentication', { cookie })).status).toBe(
      200
    );
    const revoke = await call(f.t, '/api/me/oidc/revoke', {
      cookie,
      json: { bindingId: f.bindingId, revision: 1 },
      headers: { 'X-CloudForge-Session': next.session.id },
    });
    expect(revoke.status).toBe(200);
    expect(
      await f.t.env.DB.prepare('SELECT id FROM sessions WHERE id=?')
        .bind(next.session.id)
        .first()
    ).toBeNull();
    expect((await call(f.t, '/api/me/authentication', { cookie })).status).toBe(
      401
    );
    expect(
      await (await call(f.t, '/api/auth/get-session', { cookie })).json()
    ).toBeNull();
  });

  it('REST与SDK都读取有效来源，公开证明不会泄漏私有来源字段', async () => {
    const f = await sourcedSession();
    const res = await call(f.t, '/api/me/authentication', { cookie: f.cookie });
    expect(res.status).toBe(200);
    const proof = await res.json();
    expect(proof).toMatchObject({
      sessionId: f.sessionId,
      strength: 'oidc',
      primary: { method: 'oidc' },
      source: { method: 'oidc' },
    });
    expect(JSON.stringify(proof)).not.toContain(f.bindingId);
    const sdk = (await (
      await call(f.t, '/api/auth/get-session', { cookie: f.cookie })
    ).json()) as { session: Record<string, unknown> };
    expect(sdk.session.id).toBe(f.sessionId);
    for (const key of [
      'oidcBindingId',
      'oidcBindingRevision',
      'oidcConfigurationGeneration',
    ])
      expect(sdk.session).not.toHaveProperty(key);
    expect(await readSessionAuthentication(f.t.env, f.sessionId)).toMatchObject(
      { oidcBindingId: f.bindingId }
    );
    const mutation = await call(f.t, '/api/tokens', {
      cookie: f.cookie,
      json: { name: 'no-idp-password' },
      headers: { 'X-CloudForge-Session': f.sessionId },
    });
    expect(mutation.status).toBe(403);
    expect(await mutation.json()).toMatchObject({
      code: 'RECENT_AUTHENTICATION_REQUIRED',
    });
  });

  it.each(['enabled=0', 'login_enabled=0', 'generation=2'])(
    '配置撤权%s即使保留cookie也同时阻止REST和SDK',
    async (change) => {
      const f = await sourcedSession();
      await f.t.env.DB.prepare(
        `UPDATE oidc_configuration SET ${change} WHERE id=1`
      ).run();
      expect(await readSessionAuthentication(f.t.env, f.sessionId)).toBeNull();
      expect(
        (await call(f.t, '/api/me/authentication', { cookie: f.cookie })).status
      ).toBe(401);
      expect(
        await (
          await call(f.t, '/api/auth/get-session', { cookie: f.cookie })
        ).json()
      ).toBeNull();
    }
  );

  it('真实本地重验保留来源，之后撤销自己的绑定会使该会话失效', async () => {
    const f = await sourcedSession();
    const reauth = await call(f.t, '/api/auth/reauthenticate', {
      cookie: f.cookie,
      json: { sessionId: f.sessionId, password: 'password123' },
      headers: { 'X-CloudForge-Session': f.sessionId },
    });
    expect(reauth.status).toBe(200);
    expect(await readSessionAuthentication(f.t.env, f.sessionId)).toMatchObject(
      {
        authMethod: 'password',
        oidcBindingId: f.bindingId,
        oidcBindingRevision: 1,
        oidcConfigurationGeneration: 1,
      }
    );
    const revoke = await call(f.t, '/api/me/oidc/revoke', {
      cookie: f.cookie,
      json: { bindingId: f.bindingId, revision: 1 },
      headers: { 'X-CloudForge-Session': f.sessionId },
    });
    expect(revoke.status).toBe(200);
    expect(await readSessionAuthentication(f.t.env, f.sessionId)).toBeNull();
    expect(
      await f.t.env.DB.prepare('SELECT id FROM sessions WHERE id=?')
        .bind(f.sessionId)
        .first()
    ).toBeNull();
    expect(
      await (
        await call(f.t, '/api/auth/get-session', { cookie: f.cookie })
      ).json()
    ).toBeNull();
  });
});
