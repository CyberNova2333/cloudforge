import { describe, expect, it } from 'vitest';
import verifyExisting from '../../../migrations/0032_verify_existing_accounts.sql?raw';
import { newAgent } from './helpers/agents';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  signIn,
  type TestEnv,
} from './helpers/app';

const setting = (t: TestEnv, cookie: string, key: string, value: unknown) =>
  call(t, `/api/admin/settings/${key}`, {
    cookie,
    method: 'PUT',
    json: { value },
  });

function signUp(
  t: TestEnv,
  who: { username?: string; email: string; password?: string }
) {
  return call(t, '/api/auth/sign-up/email', {
    json: {
      name: who.username ?? 'Someone',
      email: who.email,
      password: who.password ?? 'password123',
      ...(who.username !== undefined && { username: who.username }),
      callbackURL: '/',
    },
  });
}

const errorOf = async (res: Response) =>
  (await res.json()) as { message?: string; code?: string };

/** The verification link in the last email to `to` (http://test.local/api/auth/verify-email?…). */
function verifyLink(t: TestEnv, to: string): string {
  const mail = [...t.sent].reverse().find((m) => m.to === to);
  const url = mail?.text?.match(/https?:\/\/\S+verify-email\S+/)?.[0];
  if (!url) throw new Error(`no verification email to ${to}`);
  return url.replace('http://test.local', '');
}

async function setup() {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  return { t, admin };
}

describe('self sign-up', () => {
  it('is refused before the first admin exists', async () => {
    const t = makeEnv();
    const res = await signUp(t, { username: 'eve', email: 'eve@example.com' });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe('Set up the instance first.');
  });

  it('is off by default, and creates nobody', async () => {
    const { t } = await setup();
    const res = await signUp(t, { username: 'eve', email: 'eve@example.com' });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe(
      'Self sign-up is off. Ask an administrator for an invitation.'
    );
    await expect(signIn(t, 'eve', 'password123')).rejects.toThrow();
  });

  it('asks a new account to confirm its email before the first sign-in', async () => {
    const { t, admin } = await setup();
    expect((await setting(t, admin, 'signup.enabled', true)).status).toBe(200);
    const res = await signUp(t, { username: 'eve', email: 'eve@example.com' });
    expect(res.status).toBe(200);
    // No session from the sign-up itself.
    expect(res.headers.getSetCookie()).toEqual([]);

    const blocked = await call(t, '/api/auth/sign-in/username', {
      json: { username: 'eve', password: 'password123' },
    });
    expect(blocked.status).toBe(403);
    expect((await errorOf(blocked)).code).toBe('EMAIL_NOT_VERIFIED');

    // The emailed link confirms the address and signs in.
    const verified = await call(t, verifyLink(t, 'eve@example.com'));
    expect(verified.status).toBeLessThan(400);
    const cookie = await signIn(t, 'eve', 'password123');
    const me = await call(t, '/api/auth/get-session', { cookie });
    expect(
      ((await me.json()) as { user: { username: string; role: string } }).user
    ).toMatchObject({ username: 'eve', role: 'user' });
  });

  it('signs in at once while verification is off', async () => {
    const { t, admin } = await setup();
    await setting(t, admin, 'signup.enabled', true);
    await setting(t, admin, 'signup.require_verification', false);
    const before = t.sent.length;
    expect(
      (await signUp(t, { username: 'eve', email: 'eve@example.com' })).status
    ).toBe(200);
    expect(t.sent.length).toBe(before);
    await expect(signIn(t, 'eve', 'password123')).resolves.toContain(
      'cloudforge'
    );
  });

  it('accepts only the allowed email domains', async () => {
    const { t, admin } = await setup();
    await setting(t, admin, 'signup.enabled', true);
    expect(
      (
        await setting(
          t,
          admin,
          'signup.allowed_domains',
          'example.org, Corp.Example.com'
        )
      ).status
    ).toBe(200);
    expect(
      (await setting(t, admin, 'signup.allowed_domains', 'not a domain!'))
        .status
    ).toBe(400);

    const outside = await signUp(t, {
      username: 'eve',
      email: 'eve@example.com',
    });
    expect(outside.status).toBe(403);
    expect((await errorOf(outside)).message).toBe(
      'Accounts with this email domain can’t sign up here.'
    );
    expect(
      (await signUp(t, { username: 'eve', email: 'eve@corp.example.com' }))
        .status
    ).toBe(200);
  });

  it('needs a username the URL namespace does not hold', async () => {
    const { t, admin } = await setup();
    await setting(t, admin, 'signup.enabled', true);
    await call(t, '/api/team', {
      cookie: admin,
      method: 'PUT',
      json: { name: 'XY Space', slug: 'xyspace' },
    });
    const team = await signUp(t, {
      username: 'xyspace',
      email: 'x@example.com',
    });
    expect(team.status).toBe(400);
    expect((await errorOf(team)).message).toBe('Username is not available.');
    const none = await signUp(t, { email: 'y@example.com' });
    expect(none.status).toBe(400);
    expect((await errorOf(none)).message).toBe('Choose a username.');
  });

  it('sends the link again only to a sign-up still waiting for it', async () => {
    const { t, admin } = await setup();
    await setting(t, admin, 'signup.enabled', true);
    await signUp(t, { username: 'eve', email: 'eve@example.com' });
    await addMember(t, admin, 'bob');
    const resend = (email: string) =>
      call(t, '/api/auth/send-verification-email', {
        json: { email, callbackURL: '/' },
      });
    const before = t.sent.length;
    expect((await resend('eve@example.com')).status).toBe(200);
    expect(t.sent.length).toBe(before + 1);
    // An invited member, or nobody at all: refused (400, or 429 from better-auth's own rate limit), nothing sent.
    expect((await resend('bob@example.com')).ok).toBe(false);
    expect((await resend('nobody@example.com')).ok).toBe(false);
    expect(t.sent.length).toBe(before + 1);
    // Once confirmed, there is nothing left to send.
    await call(t, verifyLink(t, 'eve@example.com'));
    expect((await resend('eve@example.com')).ok).toBe(false);
    expect(t.sent.length).toBe(before + 1);
  });

  it('never holds back invited members, even while verification is on', async () => {
    const { t, admin } = await setup();
    await setting(t, admin, 'signup.enabled', true);
    // addMember signs the new member in; it throws if sign-in is refused.
    await expect(addMember(t, admin, 'bob')).resolves.toContain('cloudforge');
  });
});

describe('verified emails', () => {
  const verified = async (t: TestEnv, username: string) =>
    (await t.env.DB.prepare(
      'SELECT email_verified AS v FROM users WHERE username = ?'
    )
      .bind(username)
      .first<{ v: number }>())!.v === 1;

  it('start verified for setup, invitations and the admin API; unverified only for self sign-up', async () => {
    const { t, admin } = await setup();
    await addMember(t, admin, 'bob');
    const created = await call(t, '/api/auth/admin/create-user', {
      cookie: admin,
      json: {
        email: 'carol@example.com',
        password: 'password123',
        name: 'Carol',
        data: { username: 'carol' },
      },
    });
    expect(created.status).toBe(200);
    await setting(t, admin, 'signup.enabled', true);
    await signUp(t, { username: 'eve', email: 'eve@example.com' });
    expect(await verified(t, 'octocat')).toBe(true);
    expect(await verified(t, 'bob')).toBe(true);
    expect(await verified(t, 'carol')).toBe(true);
    expect(await verified(t, 'eve')).toBe(false);
    // The admin API's account signs in while verification is required.
    await expect(signIn(t, 'carol', 'password123')).resolves.toContain(
      'cloudforge'
    );
  });

  it('migration 0032 marks earlier people verified, never agents', async () => {
    const { t, admin } = await setup();
    const agent = await newAgent(t, admin);
    // As before the migration: nobody verified.
    await t.env.DB.prepare('UPDATE users SET email_verified = 0').run();
    for (const statement of verifyExisting
      .split('--> statement-breakpoint')
      .map((q) => q.replace(/^--.*$/gm, '').trim())
      .filter(Boolean))
      await t.env.DB.prepare(statement).run();
    expect(await verified(t, 'octocat')).toBe(true);
    const a = await t.env.DB.prepare(
      'SELECT email_verified AS v FROM users WHERE id = ?'
    )
      .bind(agent.id)
      .first<{ v: number }>();
    expect(a!.v).toBe(0);
  });
});

describe('setup status', () => {
  it('tells the sign-in page about sign-up and the default language', async () => {
    const { t, admin } = await setup();
    type Status = {
      defaultLanguage: string;
      signup: { enabled: boolean; domains: string[]; verification: boolean };
    };
    const before = (await (
      await call(t, '/api/setup/status')
    ).json()) as Status;
    expect(before).toMatchObject({
      defaultLanguage: 'auto',
      signup: { enabled: false, domains: [], verification: true },
    });
    await setting(t, admin, 'signup.enabled', true);
    await setting(t, admin, 'signup.allowed_domains', 'example.org');
    await setting(t, admin, 'ui.default_language', 'zh');
    expect((await setting(t, admin, 'ui.default_language', 'fr')).status).toBe(
      400
    );
    const after = (await (await call(t, '/api/setup/status')).json()) as Status;
    expect(after).toMatchObject({
      defaultLanguage: 'zh',
      signup: { enabled: true, domains: ['example.org'] },
    });
  });

  it('gives Site admin a control for each new setting', async () => {
    const { t, admin } = await setup();
    const { settings } = (await (
      await call(t, '/api/admin/settings', { cookie: admin })
    ).json()) as {
      settings: {
        key: string;
        group: string;
        input: string;
        optional?: boolean;
        options?: { value: string }[];
      }[];
    };
    const byKey = Object.fromEntries(settings.map((s) => [s.key, s]));
    expect(byKey['signup.enabled']).toMatchObject({
      group: 'Accounts',
      input: 'boolean',
    });
    expect(byKey['signup.allowed_domains']).toMatchObject({
      input: 'text',
      optional: true,
    });
    expect(byKey['ui.default_language'].options?.map((o) => o.value)).toEqual([
      'auto',
      'zh',
      'en',
    ]);
    expect(byKey['actions.max_concurrent_jobs'].input).toBe('number');
    expect(byKey['app.name']).toMatchObject({ input: 'text', optional: false });
  });
});

describe('preferences', () => {
  it('keeps a member’s language with their account', async () => {
    const { t, admin } = await setup();
    const bob = await addMember(t, admin, 'bob');
    const get = async (cookie: string) =>
      (await (await call(t, '/api/me/preferences', { cookie })).json()) as {
        language: string | null;
      };
    expect(await get(bob)).toEqual({ language: null });
    const put = (cookie: string, language: unknown) =>
      call(t, '/api/me/preferences', {
        cookie,
        method: 'PUT',
        json: { language },
      });
    expect((await put(bob, 'zh')).status).toBe(200);
    expect(await get(bob)).toEqual({ language: 'zh' });
    // Someone else's choice is their own.
    expect(await get(admin)).toEqual({ language: null });
    expect((await put(bob, null)).status).toBe(200);
    expect(await get(bob)).toEqual({ language: null });
    expect((await put(bob, 'fr')).status).toBe(400);
    expect((await call(t, '/api/me/preferences')).status).toBe(401);
  });

  it('keeps one row per changed preference, and none for a default', async () => {
    const { t, admin } = await setup();
    const rows = async () =>
      (
        await t.env.DB.prepare(
          'SELECT key, value FROM user_preferences ORDER BY key'
        ).all<{ key: string; value: string }>()
      ).results;
    const put = (json: unknown) =>
      call(t, '/api/me/preferences', { cookie: admin, method: 'PUT', json });
    await put({ language: 'en' });
    expect(await rows()).toEqual([{ key: 'language', value: '"en"' }]);
    // A body without a key leaves that preference alone.
    expect(await (await put({})).json()).toEqual({ language: 'en' });
    await put({ language: null });
    expect(await rows()).toEqual([]);
  });
});
