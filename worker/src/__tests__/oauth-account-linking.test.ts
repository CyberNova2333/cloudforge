import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import type { BetterAuthOptions } from 'better-auth';
import { authFor } from '../auth';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from './helpers/app';

const PROVIDER = 'foundation-test';
const SUBJECT = 'immutable-subject';
const PASSWORD = 'password123';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
});
afterEach(() => vi.useRealTimers());

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

/** Only the external identity service is fake; native state, callback, hooks and D1 writes are real. */
async function provider(
  t: TestEnv,
  options: { email?: string; emailVerified?: boolean; trusted?: boolean } = {}
) {
  const context = await authFor(t.env).$context;
  let verifier: string | undefined;
  let exchanges = 0;
  context.socialProviders.push({
    id: PROVIDER,
    name: 'Only installed by this test',
    accountSubject: ({ profile }) => (profile as { sub: string }).sub,
    createAuthorizationURL: async ({ state, codeVerifier, redirectURI }) => {
      verifier = codeVerifier;
      const url = new URL('https://identity.example/authorize');
      url.searchParams.set('state', state);
      url.searchParams.set('redirect_uri', redirectURI);
      return url;
    },
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
      expect(code).toBe('one-valid-code');
      expect(codeVerifier).toBe(verifier);
      expect(codeVerifier).toMatch(/^[a-zA-Z0-9_-]{43,}$/);
      expect(redirectURI).toBe(
        `http://test.local/api/auth/callback/${PROVIDER}`
      );
      exchanges++;
      return {
        accessToken: 'external-token-not-used-outside-test',
        scopes: ['openid', 'email'],
      };
    },
    getUserInfo: async () => ({
      user: {
        email: options.email ?? 'octocat@example.com',
        emailVerified: options.emailVerified ?? true,
        name: 'External profile',
      },
      data: { sub: SUBJECT },
    }),
    options: { disableSignUp: true },
  });
  // The framework resolves trusted providers per request from options, not this base context's array.
  if (options.trusted) {
    const runtimeOptions: BetterAuthOptions = context.options;
    const config = (runtimeOptions.account ??= {});
    (config.accountLinking ??= {}).trustedProviders = [PROVIDER];
  }
  return { exchanges: () => exchanges };
}

async function flow(t: TestEnv, path = 'sign-in/social', cookie?: string) {
  const started = await call(t, `/api/auth/${path}`, {
    cookie,
    json: {
      provider: PROVIDER,
      callbackURL: '/settings/security',
      errorCallbackURL: '/login',
      disableRedirect: true,
    },
  });
  expect(started.status, await started.clone().text()).toBe(200);
  expect(started.headers.get('cache-control')).toBe('no-store');
  const authorization = new URL(
    ((await started.json()) as { url: string }).url
  );
  expect(authorization.origin).toBe('https://identity.example');
  const state = authorization.searchParams.get('state');
  expect(state).toBeTruthy();
  const callbackCookie = [cookie, cookies(started)].filter(Boolean).join('; ');
  const callback = await call(
    t,
    `/api/auth/callback/${PROVIDER}?${new URLSearchParams({ state: state!, code: 'one-valid-code' })}`,
    {
      cookie: callbackCookie,
    }
  );
  expect(callback.status, await callback.clone().text()).toBe(302);
  expect(callback.headers.get('cache-control')).toBe('no-store');
  return callback;
}

async function counts(t: TestEnv) {
  return t.env.DB.prepare(
    `SELECT (SELECT count(*) FROM accounts WHERE provider_id = ?) AS linked,
    (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM users) AS people`
  )
    .bind(PROVIDER)
    .first();
}

async function linked(t: TestEnv, username: string) {
  const owner = (await t.env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  )
    .bind(username)
    .first<{ id: string }>())!;
  await t.env.DB.prepare(
    'INSERT INTO accounts (id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)'
  )
    .bind(
      crypto.randomUUID(),
      SUBJECT,
      PROVIDER,
      owner.id,
      Date.now(),
      Date.now()
    )
    .run();
  return owner.id;
}

describe('外部身份联结的安全默认值', () => {
  it('未配置外部提供商时，真实social入口不能开启登录', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const before = await counts(t);
    const response = await call(t, '/api/auth/sign-in/social', {
      json: { provider: PROVIDER, callbackURL: '/' },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
    expect(await counts(t)).toEqual(before);
  });

  for (const trusted of [false, true])
    it(`${trusted ? '受信提供商' : '已验证邮箱'}的同邮箱回调不能隐式联结或建立成员会话`, async () => {
      const t = makeEnv();
      await bootstrapAdmin(t);
      const external = await provider(t, { trusted, emailVerified: !trusted });
      const before = await counts(t);
      const response = await flow(t);
      expect(
        new URL(
          response.headers.get('location')!,
          'http://test.local'
        ).searchParams.get('error'),
        `Database state after callback: ${JSON.stringify(await counts(t))}`
      ).toBe('account_not_linked');
      expect(external.exchanges()).toBe(1);
      expect(await counts(t)).toEqual(before);
      expect(
        response.headers
          .getSetCookie()
          .some((value) => /^cloudforge\.session_token=/.test(value))
      ).toBe(false);
      expect(
        await (
          await call(t, '/api/auth/get-session', { cookie: cookies(response) })
        ).json()
      ).toBeNull();
    });

  it('显式联结的原生回调在应用围栏尚未实现时也不得新增联结', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const external = await provider(t);
    const before = await counts(t);
    const response = await flow(t, 'link-social', cookie);
    expect(
      new URL(
        response.headers.get('location')!,
        'http://test.local'
      ).searchParams.get('error')
    ).toBe('unable_to_link_account');
    expect(external.exchanges()).toBe(1);
    expect(await counts(t)).toEqual(before);
  });

  it('准确已有联结仍以不可变subject定位原成员，不以回调邮箱改绑另一成员', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    const bobId = await linked(t, 'bob');
    const external = await provider(t, { email: 'octocat@example.com' });
    const before = (await counts(t)) as {
      linked: number;
      sessions: number;
      people: number;
    };
    const response = await flow(t);
    expect(
      new URL(response.headers.get('location')!, 'http://test.local').pathname
    ).toBe('/settings/security');
    expect(external.exchanges()).toBe(1);
    const active = (await (
      await call(t, '/api/auth/get-session', { cookie: cookies(response) })
    ).json()) as {
      user: { id: string; email: string };
      session: { id: string };
    };
    expect(active.user).toMatchObject({ id: bobId, email: 'bob@example.com' });
    expect(await counts(t)).toEqual({
      ...before,
      sessions: before.sessions + 1,
    });
    const evidence = await call(t, '/api/me/authentication', {
      cookie: cookies(response),
    });
    expect(await evidence.json()).toMatchObject({
      strength: 'unknown',
      primary: null,
      secondFactor: null,
    });
    const personalTokensBefore = await t.env.DB.prepare(
      'SELECT count(*) AS n FROM personal_access_tokens'
    ).first();
    const sensitive = await call(t, '/api/tokens', {
      cookie: cookies(response),
      json: { name: 'must-not-inherit-password-proof' },
    });
    expect(sensitive.status).toBe(403);
    expect(await sensitive.json()).toMatchObject({
      code: 'RECENT_AUTHENTICATION_REQUIRED',
    });
    expect(
      await t.env.DB.prepare(
        'SELECT count(*) AS n FROM personal_access_tokens'
      ).first()
    ).toEqual(personalTokensBefore);
  });

  it('准确已有联结不能绕过成员已经启用的本地第二因子', async () => {
    const t = makeEnv();
    let cookie = await bootstrapAdmin(t);
    const enable = await call(t, '/api/auth/two-factor/enable', {
      cookie,
      json: { password: PASSWORD },
    });
    expect(enable.status).toBe(200);
    const { totpURI } = (await enable.json()) as { totpURI: string };
    const otp = createOTP(
      new TextDecoder().decode(
        base32.decode(new URL(totpURI).searchParams.get('secret')!)
      )
    );
    const confirmed = await call(t, '/api/auth/two-factor/verify-totp', {
      cookie,
      json: { code: await otp.totp() },
    });
    expect(confirmed.status).toBe(200);
    cookie = cookies(confirmed);
    await linked(t, 'octocat');
    await provider(t);
    const before = await counts(t);
    const response = await flow(t);
    expect(
      new URL(
        response.headers.get('location')!,
        'http://test.local'
      ).searchParams.get('error')
    ).toBe('MFA_SIGN_IN_REQUIRED');
    expect(await counts(t)).toEqual(before);
    expect((await call(t, '/api/auth/get-session', { cookie })).status).toBe(
      200
    );
  });

  it('拒绝外部同邮箱联结后，原成员仍可使用真实密码登录', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    await provider(t);
    await flow(t);
    const response = await call(t, '/api/auth/sign-in/username', {
      json: { username: 'octocat', password: PASSWORD },
    });
    expect(response.status).toBe(200);
    const evidence = await call(t, '/api/me/authentication', {
      cookie: cookies(response),
    });
    expect(await evidence.json()).toMatchObject({
      strength: 'password',
      primary: { method: 'password' },
      secondFactor: null,
    });
    expect(
      await t.env.DB.prepare(
        'SELECT count(*) AS n FROM accounts WHERE provider_id = ?'
      )
        .bind(PROVIDER)
        .first()
    ).toEqual({ n: 0 });
  });
});
