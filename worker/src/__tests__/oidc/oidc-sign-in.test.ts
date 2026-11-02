// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { app } from '../../index';
import { authFor } from '../../auth';
import { createEmailVerificationToken } from 'better-auth/api';
import type { BetterAuthOptions } from 'better-auth';
type SessionCreateHooks = NonNullable<
  NonNullable<
    NonNullable<BetterAuthOptions['databaseHooks']>['session']
  >['create']
>;
import { makeEnv, type TestEnv } from '../helpers/app';
import { providerFrom } from '../../oidc/provider';
import * as linking from '../../oidc/service';
import { readSessionAuthentication } from '../../auth/assurance';
let key: Awaited<ReturnType<typeof generateKeyPair>>, jwk: JWK;
beforeAll(async () => {
  key = await generateKeyPair('ES256');
  jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: 'sso',
    alg: 'ES256',
    use: 'sig',
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const BASE = '/api/auth/oidc-sign-in';
const cookies = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
async function request(
  t: TestEnv,
  path: string,
  body?: unknown,
  cookie = '',
  origin: string | null = 'https://test.local'
) {
  const h = new Headers();
  if (origin) h.set('origin', origin);
  if (cookie) h.set('cookie', cookie);
  if (body !== undefined) h.set('content-type', 'application/json');
  return app.fetch(
    new Request('https://test.local' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    t.env,
    t.ctx
  );
}
async function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
  const t = makeEnv();
  Object.assign(t.env, { BASE_URL: 'https://test.local' });
  expect(
    (
      await request(t, '/api/setup', {
        name: 'Owner',
        username: 'owner',
        email: 'owner@example.com',
        password: 'password123',
      })
    ).status
  ).toBe(200);
  const native = await request(t, '/api/auth/sign-in/username', {
    username: 'owner',
    password: 'password123',
  });
  expect(native.status).toBe(200);
  const localCookie = cookies(native);
  const local = (await (
    await request(t, '/api/auth/get-session', undefined, localCookie)
  ).json()) as { user: { id: string }; session: { id: string } };
  const issuer = 'https://identity.example/' + crypto.randomUUID(),
    description = {
      id: 'company',
      name: 'Company SSO',
      issuer,
      clientId: 'sso-client',
      version: 1,
      loginEnabled: true,
    };
  Object.assign(t.env, {
    OIDC_PROVIDER: JSON.stringify(description),
    OIDC_CLIENT_SECRET: 'sso-secret',
  });
  const p = (await providerFrom(t.env))!,
    bindingId = crypto.randomUUID(),
    now = Date.now();
  await t.env.DB.batch([
    t.env.DB.prepare(
      'INSERT INTO oidc_providers(id,issuer,version,digest,created_at) VALUES(?,?,1,?,?)'
    ).bind(p.id, p.issuer, p.digest, now),
    t.env.DB.prepare(
      'INSERT INTO oidc_configuration(id,enabled,login_enabled,provider_id,version,digest,generation,action_id,updated_at) VALUES(1,1,1,?,1,?,1,?,?)'
    ).bind(p.id, p.digest, crypto.randomUUID(), now),
    t.env.DB.prepare(
      'INSERT INTO oidc_bindings(id,provider_id,issuer,subject,user_id,active,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)'
    ).bind(bindingId, p.id, p.issuer, 'owner-subject', local.user.id, now, now),
  ]);
  const codes = new Map<string, { nonce: string; subject: string }>();
  let exchanges = 0,
    hold: (() => Promise<void>) | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === issuer + '/.well-known/openid-configuration')
        return Response.json({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          jwks_uri: issuer + '/jwks',
          id_token_signing_alg_values_supported: ['ES256'],
          code_challenge_methods_supported: ['S256'],
        });
      if (url === issuer + '/jwks') return Response.json({ keys: [jwk] });
      if (url === issuer + '/token') {
        exchanges++;
        if (hold) await hold();
        const data = codes.get(
          new URLSearchParams(String(init?.body)).get('code')!
        );
        if (!data)
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        const now = Math.floor(Date.now() / 1000);
        return Response.json({
          id_token: await new SignJWT({
            iss: issuer,
            aud: p.clientId,
            sub: data.subject,
            nonce: data.nonce,
            iat: now,
            exp: now + 300,
            email: 'owner@example.com',
          })
            .setProtectedHeader({ alg: 'ES256', kid: 'sso' })
            .sign(key.privateKey),
          token_type: 'Bearer',
        });
      }
      throw new Error('Unexpected external URL ' + url);
    })
  );
  async function start(subject = 'owner-subject') {
    const r = await request(t, BASE + '/start', {
      returnTo: '/repositories?view=all',
    });
    expect(r.status, await r.clone().text()).toBe(200);
    const url = new URL(
        ((await r.json()) as { authorizationUrl: string }).authorizationUrl
      ),
      cookie = cookies(r),
      state = url.searchParams.get('state')!,
      code = crypto.randomUUID();
    codes.set(code, { nonce: url.searchParams.get('nonce')!, subject });
    const row = await t.env.DB.prepare(
      'SELECT id FROM oidc_login_actions WHERE state_hash=?'
    )
      .bind(await (await import('../../oidc/provider')).hashValue(state))
      .first<{ id: string }>();
    return {
      id: row!.id,
      cookie,
      response: r,
      callback: () =>
        request(
          t,
          BASE + '/callback/company?state=' + state + '&code=' + code,
          undefined,
          cookie
        ),
    };
  }
  async function ready(subject = 'owner-subject') {
    const a = await start(subject);
    expect((await a.callback()).status).toBe(302);
    return a;
  }
  async function enroll() {
    const enabled = await request(
      t,
      '/api/auth/two-factor/enable',
      { password: 'password123' },
      localCookie
    );
    expect(enabled.status).toBe(200);
    const enrollment = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const realSecret = new URL(enrollment.totpURI).searchParams.get('secret')!,
      otp = createOTP(new TextDecoder().decode(base32.decode(realSecret)), {
        digits: 6,
        period: 30,
      });
    const verified = await request(
      t,
      '/api/auth/two-factor/verify-totp',
      { code: await otp.totp(), trustDevice: false },
      localCookie
    );
    expect(verified.status, await verified.clone().text()).toBe(200);
    vi.setSystemTime(Date.now() + 30_000);
    return {
      otp,
      backup: enrollment.backupCodes[0]!,
      cookie: cookies(verified) || localCookie,
    };
  }
  return {
    t,
    p,
    bindingId,
    local,
    localCookie,
    start,
    ready,
    enroll,
    exchanges: () => exchanges,
    hold: (v: typeof hold) => (hold = v),
  };
}
async function action(
  f: Awaited<ReturnType<typeof fixture>>,
  a: { id: string; cookie: string }
) {
  return (
    await request(f.t, BASE + '/actions/' + a.id, undefined, a.cookie)
  ).json() as Promise<any>;
}
describe('explicit linked OIDC SSO with real workerd/D1', () => {
  it('keeps callback anonymous, confirms explicitly, uses native cookie and never claims password proof', async () => {
    const f = await fixture(),
      a = await f.ready();
    expect(a.response.headers.getSetCookie()[0]).toMatch(
      /^__Host-cloudforge\.oidc-login\.[a-f0-9]{64}=/
    );
    expect(a.response.headers.getSetCookie()[0]).toContain('Path=/');
    expect(a.response.headers.getSetCookie()[0]).toContain('Secure');
    expect(a.response.headers.getSetCookie()[0]).not.toContain('Domain=');
    expect(
      await (
        await request(f.t, '/api/auth/get-session', undefined, a.cookie)
      ).json()
    ).toBeNull();
    expect(await action(f, a)).toMatchObject({
      status: 'ready',
      user: { id: f.local.user.id },
      factorRequired: false,
    });
    const complete = await request(
      f.t,
      BASE + '/complete',
      { actionId: a.id },
      a.cookie
    );
    expect(complete.status, await complete.clone().text()).toBe(200);
    const body = (await complete.json()) as any;
    expect(body).not.toHaveProperty('token');
    const cookie = a.cookie + '; ' + cookies(complete);
    const session = (await (
      await request(f.t, '/api/auth/get-session', undefined, cookie)
    ).json()) as any;
    expect(session.session.id).toBe(body.sessionId);
    expect(session.user.id).toBe(f.local.user.id);
    expect(session.session).not.toHaveProperty('oidcBindingId');
    expect(
      await readSessionAuthentication(f.t.env, body.sessionId)
    ).toMatchObject({ authMethod: 'oidc', oidcBindingId: f.bindingId });
    expect(await action(f, a)).toMatchObject({
      status: 'signed_in',
      sessionId: body.sessionId,
    });
    const token = await request(
      f.t,
      '/api/tokens',
      { name: 'not-password' },
      cookie
    );
    expect(token.status).toBe(403);
    expect(await token.json()).toMatchObject({
      code: 'RECENT_AUTHENTICATION_REQUIRED',
    });
    expect(
      (await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie))
        .status
    ).toBe(409);
  });
  it('matching email with an unknown subject creates no local member/account/session', async () => {
    const f = await fixture(),
      before = await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM sessions'
      ).first(),
      a = await f.ready('unknown-subject');
    expect(await action(f, a)).toMatchObject({ status: 'failed', user: null });
    expect(
      (await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie))
        .status
    ).toBe(409);
    expect(
      await f.t.env.DB.prepare('SELECT count(*) AS n FROM sessions').first()
    ).toEqual(before);
    expect(
      await f.t.env.DB.prepare('SELECT count(*) AS n FROM accounts').first()
    ).toMatchObject({ n: 1 });
  });
  it('rejects foreign/missing Origin, invalid targets, and an already signed-in browser', async () => {
    const f = await fixture();
    for (const origin of [null, 'https://foreign.example'])
      expect(
        (await request(f.t, BASE + '/start', { returnTo: '/' }, '', origin))
          .status
      ).toBe(403);
    for (const returnTo of [
      '//foreign.example',
      '/api/tokens',
      '/api',
      '/login/oidc',
      '/a\\b',
      '/%2f%2fforeign',
    ])
      expect((await request(f.t, BASE + '/start', { returnTo })).status).toBe(
        400
      );
    expect(
      (await request(f.t, BASE + '/start', { returnTo: '/' }, f.localCookie))
        .status
    ).toBe(409);
  });
  it('wrong proof and duplicate callback cannot claim the exchange twice', async () => {
    const f = await fixture(),
      a = await f.start();
    expect((await request(f.t, BASE + '/actions/' + a.id)).status).toBe(401);
    await Promise.all([a.callback(), a.callback()]);
    expect(f.exchanges()).toBe(1);
    expect(await action(f, a)).toMatchObject({ status: 'ready' });
  });
  it('enabled local factors remain mandatory and share the global TOTP step claim', async () => {
    const f = await fixture(),
      factor = await f.enroll(),
      a = await f.ready(),
      b = await f.ready();
    expect(await action(f, a)).toMatchObject({
      factorRequired: true,
      status: 'ready',
    });
    expect(
      (await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie))
        .status
    ).toBe(403);
    const code = await factor.otp.totp();
    const results = await Promise.all([
      request(
        f.t,
        BASE + '/complete',
        { actionId: a.id, method: 'totp', code },
        a.cookie
      ),
      request(
        f.t,
        BASE + '/complete',
        { actionId: b.id, method: 'totp', code },
        b.cookie
      ),
    ]);
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(
      1
    );
    const winner = results.find((r) => r.status === 200)!;
    const session = (await winner.json()) as any;
    expect(
      await readSessionAuthentication(f.t.env, session.sessionId)
    ).toMatchObject({
      authMethod: 'oidc',
      secondFactorMethod: 'totp',
      oidcBindingId: f.bindingId,
    });
  });
  it('recovery codes are consumed once in the final completion transaction', async () => {
    const f = await fixture(),
      factor = await f.enroll(),
      a = await f.ready(),
      b = await f.ready();
    const results = await Promise.all([
      request(
        f.t,
        BASE + '/complete',
        { actionId: a.id, method: 'recovery_code', code: factor.backup },
        a.cookie
      ),
      request(
        f.t,
        BASE + '/complete',
        { actionId: b.id, method: 'recovery_code', code: factor.backup },
        b.cookie
      ),
    ]);
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(
      1
    );
  });
  it.each(['binding', 'configuration', 'policy', 'credentials'])(
    'final issuance rejects stale %s',
    async (kind) => {
      const f = await fixture(),
        a = await f.ready();
      if (kind === 'binding')
        await f.t.env.DB.prepare(
          'UPDATE oidc_bindings SET active=0,revision=revision+1 WHERE id=?'
        )
          .bind(f.bindingId)
          .run();
      if (kind === 'configuration')
        await f.t.env.DB.prepare(
          'UPDATE oidc_configuration SET generation=generation+1'
        ).run();
      if (kind === 'policy')
        await f.t.env.DB.prepare(
          'INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,0)'
        ).run();
      if (kind === 'credentials')
        await f.t.env.DB.prepare(
          'UPDATE users SET auth_version=auth_version+1 WHERE id=?'
        )
          .bind(f.local.user.id)
          .run();
      expect(
        (await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie))
          .status
      ).toBe(409);
      expect(
        await f.t.env.DB.prepare(
          'SELECT count(*) AS n FROM sessions WHERE oidc_binding_id IS NOT NULL'
        ).first()
      ).toMatchObject({ n: 0 });
    }
  );
  it('forced MFA without enrollment yields no provisional member session', async () => {
    const f = await fixture();
    await f.t.env.DB.prepare(
      'INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,1)'
    ).run();
    const a = await f.ready();
    expect(await action(f, a)).toMatchObject({
      status: 'enrollment_required',
      factorRequired: false,
    });
    expect(
      (await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie))
        .status
    ).toBe(409);
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM sessions WHERE oidc_binding_id IS NOT NULL'
      ).first()
    ).toMatchObject({ n: 0 });
  });
  it('cancelled completed action revokes issued native cookie and cannot recreate a receipt', async () => {
    const f = await fixture(),
      a = await f.ready(),
      r = await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie);
    expect(r.status).toBe(200);
    const cookie = a.cookie + '; ' + cookies(r);
    expect(
      (await request(f.t, BASE + '/cancel', { actionId: a.id }, a.cookie))
        .status
    ).toBe(200);
    expect(
      await (
        await request(f.t, '/api/auth/get-session', undefined, cookie)
      ).json()
    ).toBeNull();
    expect(await action(f, a)).toMatchObject({ status: 'cancelled' });
    expect(
      (await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie))
        .status
    ).toBe(409);
  });
  it('a genuine native password sign-in cancels this browser pending and issued SSO actions', async () => {
    const f = await fixture(),
      a = await f.ready(),
      r = await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie);
    expect(r.status).toBe(200);
    const pending = await f.ready(),
      cookie = a.cookie + '; ' + pending.cookie + '; ' + cookies(r);
    const wrong = await request(
      f.t,
      '/api/auth/sign-in/username',
      { username: 'owner', password: 'wrong-password' },
      cookie
    );
    expect(wrong.status).toBe(401);
    expect(await action(f, a)).toMatchObject({ status: 'signed_in' });
    const native = await request(
      f.t,
      '/api/auth/sign-in/username',
      { username: 'owner', password: 'password123' },
      cookie
    );
    expect(native.status).toBe(200);
    expect(await action(f, a)).toMatchObject({ status: 'cancelled' });
    expect(await action(f, pending)).toMatchObject({ status: 'cancelled' });
    expect(
      await (
        await request(f.t, '/api/auth/get-session', undefined, cookie)
      ).json()
    ).toBeNull();
    const final = (await (
      await request(f.t, '/api/auth/get-session', undefined, cookies(native))
    ).json()) as any;
    expect(
      await readSessionAuthentication(f.t.env, final.session.id)
    ).toMatchObject({ authMethod: 'password', oidcBindingId: null });
  });
  it('expires a verified candidate after two minutes and rejects a browser now signed in elsewhere', async () => {
    const f = await fixture(),
      a = await f.ready();
    expect((await action(f, a)).expiresAt).toBe(
      new Date(Date.now() + 120_000).toISOString()
    );
    const switched = await request(
      f.t,
      BASE + '/actions/' + a.id,
      undefined,
      a.cookie + '; ' + f.localCookie
    );
    expect(await switched.json()).toMatchObject({
      status: 'cancelled',
      user: null,
    });
    const b = await f.ready();
    vi.setSystemTime(Date.now() + 120_001);
    expect(await action(f, b)).toMatchObject({ status: 'expired' });
    expect(
      (await request(f.t, BASE + '/complete', { actionId: b.id }, b.cookie))
        .status
    ).toBe(409);
  });
  it('clears only the finished action proof; a normal receipt uses the actual issued SDK session', async () => {
    const f = await fixture(),
      a = await f.ready(),
      b = await f.ready(),
      r = await request(
        f.t,
        BASE + '/complete',
        { actionId: a.id },
        a.cookie + '; ' + b.cookie
      );
    expect(r.status).toBe(200);
    const cleared = r.headers
      .getSetCookie()
      .filter((v) => v.startsWith(a.cookie.split('=')[0] + '='));
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toContain('Max-Age=0');
    expect(
      r.headers
        .getSetCookie()
        .some((v) => v.startsWith(b.cookie.split('=')[0] + '='))
    ).toBe(false);
    const sessionCookie = cookies(r)
      .split('; ')
      .filter((v) => !v.startsWith('__Host-cloudforge.oidc-login.'))
      .join('; ');
    const receipt = await request(
      f.t,
      BASE + '/actions/' + a.id,
      undefined,
      sessionCookie
    );
    expect(await receipt.json()).toMatchObject({
      status: 'signed_in',
      user: { id: f.local.user.id },
    });
  });
  it.each(['native', 'retire'])(
    'a suspended callback cannot survive %s supersession',
    async (kind) => {
      const f = await fixture(),
        a = await f.start();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        started = new Promise<void>((r) => (entered = r));
      f.hold(async () => {
        entered();
        await gate;
      });
      const callback = a.callback();
      await started;
      if (kind === 'native')
        expect(
          (
            await request(
              f.t,
              '/api/auth/sign-in/username',
              { username: 'owner', password: 'password123' },
              a.cookie
            )
          ).status
        ).toBe(200);
      else
        await f.t.env.DB.prepare(
          "UPDATE oidc_configuration SET enabled=0,digest='retired:test',generation=generation+1"
        ).run();
      release();
      expect((await callback).status).toBe(302);
      expect((await action(f, a)).status).toMatch(/failed|cancelled/);
      expect(
        (await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie))
          .status
      ).toBe(409);
    }
  );
  it('shared attempt budget locks factor verification after ten failures across actions', async () => {
    const f = await fixture();
    await f.enroll();
    const a = await f.ready(),
      b = await f.ready();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await request(
            f.t,
            BASE + '/complete',
            { actionId: (i % 2 ? a : b).id, method: 'totp', code: 'wrong' },
            (i % 2 ? a : b).cookie
          )
        ).status
      ).toBe(403);
    expect(
      (
        await request(
          f.t,
          BASE + '/complete',
          { actionId: a.id, method: 'totp', code: '000000' },
          a.cookie
        )
      ).status
    ).toBe(429);
    expect(
      await f.t.env.DB.prepare(
        'SELECT failed_verification_count FROM two_factors WHERE user_id=?'
      )
        .bind(f.local.user.id)
        .first()
    ).toMatchObject({ failed_verification_count: 10 });
  });
  it('SSO provisional permission is request-local and cannot authorize concurrent email-verification login', async () => {
    const f = await fixture(),
      factor = await f.enroll(),
      a = await f.ready(),
      sdk = await authFor(f.t.env).$context;
    const hook = sdk.options.databaseHooks!.session!.create!;
    const original = hook.before!;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    hook.before = async (data: any, ctx: any) => {
      const result = await original(data, ctx);
      if (ctx?.path === BASE.replace('/api/auth', '') + '/complete') {
        entered();
        await gate;
      }
      return result;
    };
    try {
      const completing = request(
        f.t,
        BASE + '/complete',
        { actionId: a.id, method: 'totp', code: await factor.otp.totp() },
        a.cookie
      );
      await Promise.race([
        started,
        completing.then(async (r) => {
          throw new Error(
            'SSO completed before barrier: ' + (await r.clone().text())
          );
        }),
      ]);
      const token = await createEmailVerificationToken(
        sdk.secret,
        'owner@example.com',
        'owner@example.com'
      );
      const attempted = await request(
        f.t,
        '/api/auth/verify-email?token=' + encodeURIComponent(token)
      );
      expect(attempted.status).toBe(403);
      expect(await attempted.json()).toMatchObject({
        code: 'MFA_SIGN_IN_REQUIRED',
      });
      release();
      expect((await completing).status).toBe(200);
    } finally {
      release?.();
      hook.before = original;
    }
  });
  it('explicit publication carries loginEnabled and atomically invalidates old SSO sources', async () => {
    const f = await fixture(),
      a = await f.ready(),
      r = await request(f.t, BASE + '/complete', { actionId: a.id }, a.cookie);
    expect(r.status).toBe(200);
    const issued = (await r.json()) as any;
    const pending = await f.ready();
    Object.assign(f.t.env, {
      OIDC_PROVIDER: JSON.stringify({
        id: f.p.id,
        name: f.p.name,
        issuer: f.p.issuer,
        clientId: f.p.clientId,
        version: 2,
        loginEnabled: false,
      }),
    });
    const plan = await linking.preview(
      f.t.env,
      f.local.user.id,
      f.local.session.id,
      'configure'
    );
    await linking.applyConfiguration(
      f.t.env,
      f.local.user.id,
      f.local.session.id,
      plan.previewId,
      plan.digest
    );
    expect(await linking.currentConfiguration(f.t.env)).toMatchObject({
      enabled: 1,
      login_enabled: 0,
      version: 2,
      generation: 2,
    });
    expect(
      await f.t.env.DB.prepare('SELECT id FROM sessions WHERE id=?')
        .bind(issued.sessionId)
        .first()
    ).toBeNull();
    expect(await action(f, pending)).toMatchObject({ status: 'cancelled' });
    expect(await (await request(f.t, BASE + '/status')).json()).toEqual({
      ready: false,
      provider: null,
    });
  });
  it.each(['totp', 'recovery_code'] as const)(
    'a final session CAS failure rolls back %s consumption and action receipt',
    async (method) => {
      const f = await fixture(),
        factor = await f.enroll(),
        a = await f.ready(),
        sdk = await authFor(f.t.env).$context,
        hook = sdk.options.databaseHooks!.session!
          .create! as SessionCreateHooks,
        original = hook.after;
      hook.after = async (session, ctx) => {
        await original?.(session, ctx);
        if (ctx?.path === '/oidc-sign-in/complete')
          await f.t.env.DB.prepare('DELETE FROM sessions WHERE id=?')
            .bind(session.id)
            .run();
      };
      const code = method === 'totp' ? await factor.otp.totp() : factor.backup;
      try {
        expect(
          (
            await request(
              f.t,
              BASE + '/complete',
              { actionId: a.id, method, code },
              a.cookie
            )
          ).status
        ).toBe(409);
        expect(
          await f.t.env.DB.prepare(
            'SELECT status,session_id FROM oidc_login_actions WHERE id=?'
          )
            .bind(a.id)
            .first()
        ).toMatchObject({ status: 'ready', session_id: null });
      } finally {
        hook.after = original;
      }
      expect(
        (
          await request(
            f.t,
            BASE + '/complete',
            { actionId: a.id, method, code },
            a.cookie
          )
        ).status
      ).toBe(200);
    }
  );
  it('anonymous start has a shared atomic per-address budget and rejects insecure non-loopback origins', async () => {
    const f = await fixture();
    for (let i = 0; i < 10; i++) await f.start();
    expect(
      (await request(f.t, BASE + '/start', { returnTo: '/' })).status
    ).toBe(429);
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM oidc_login_actions'
      ).first()
    ).toMatchObject({ n: 10 });
    const env = {
      ...f.t.env,
      BASE_URL: 'http://test.local',
    } as unknown as CloudflareBindings;
    const r = await app.fetch(
      new Request('http://test.local' + BASE + '/start', {
        method: 'POST',
        headers: {
          origin: 'http://test.local',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ returnTo: '/' }),
      }),
      env,
      f.t.ctx
    );
    expect(r.status).toBe(409);
    expect(r.headers.getSetCookie()).toHaveLength(0);
  });

  it('expired anonymous rate inventory recovers for a new address without an old caller', async () => {
    const f = await fixture(),
      stale = Array.from({ length: 4096 }, (_, i) => 'stale-' + i);
    await f.t.env.DB.prepare(
      "INSERT INTO rate_limits(id,key,count,last_request) SELECT value,'cloudforge:oidc-start:'||value,10,? FROM json_each(?)"
    )
      .bind(Date.now() - 700_000, JSON.stringify(stale))
      .run();
    expect(
      (await request(f.t, BASE + '/start', { returnTo: '/' })).status
    ).toBe(200);
  });

  it('genuine native factor completion cancels an SSO action started after its password challenge', async () => {
    const f = await fixture(),
      factor = await f.enroll();
    const first = await request(f.t, '/api/auth/sign-in/username', {
      username: 'owner',
      password: 'password123',
    });
    expect(await first.clone().json()).toMatchObject({
      twoFactorRedirect: true,
    });
    const a = await f.ready();
    const verified = await request(
      f.t,
      '/api/auth/two-factor/verify-totp',
      { code: await factor.otp.totp(), trustDevice: false },
      cookies(first) + '; ' + a.cookie
    );
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(await action(f, a)).toMatchObject({ status: 'cancelled' });
    const active = (await (
      await request(f.t, '/api/auth/get-session', undefined, cookies(verified))
    ).json()) as any;
    expect(
      await readSessionAuthentication(f.t.env, active.session.id)
    ).toMatchObject({ authMethod: 'password', oidcBindingId: null });
  });
  it('successful native sign-out cancels a second tab pending SSO proof instead of allowing re-login', async () => {
    const f = await fixture(),
      a = await f.ready(),
      b = await f.ready();
    const completed = await request(
      f.t,
      BASE + '/complete',
      { actionId: a.id },
      a.cookie + '; ' + b.cookie
    );
    expect(completed.status).toBe(200);
    const current = b.cookie + '; ' + cookies(completed);
    const rejected = await request(
      f.t,
      '/api/auth/sign-out',
      {},
      current,
      'https://foreign.example'
    );
    expect(rejected.status).toBe(403);
    expect(await action(f, b)).toMatchObject({ status: 'ready' });
    const out = await request(f.t, '/api/auth/sign-out', {}, current);
    expect(out.status).toBe(200);
    expect(await out.json()).toMatchObject({ success: true });
    expect(
      await (
        await request(f.t, '/api/auth/get-session', undefined, current)
      ).json()
    ).toBeNull();
    expect(await action(f, b)).toMatchObject({
      status: 'cancelled',
      user: null,
    });
    expect(
      (await request(f.t, BASE + '/complete', { actionId: b.id }, b.cookie))
        .status
    ).toBe(409);
  });
});
