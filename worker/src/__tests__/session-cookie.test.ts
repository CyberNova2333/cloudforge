import { expect, it } from 'vitest';
import { authFor } from '../auth';
import { bootstrapAdmin, call, makeEnv } from './helpers/app';

const COOKIE = 'cloudforge.session_token';

/** The admin's session cookie as the browser holds it, under `name`. */
async function signedIn(name: string) {
  const t = makeEnv();
  const cookie = await bootstrapAdmin(t);
  const value = cookie
    .split('; ')
    .find((c) => c.startsWith(`${COOKIE}=`))!
    .slice(COOKIE.length + 1);
  return { t, value, cookie: `${name}=${value}` };
}

const me = (t: ReturnType<typeof makeEnv>, cookie: string) =>
  call(t, '/api/me/preferences', { cookie });

it('HTTPS 下只按 better-auth 使用的 __Secure- 名读取会话 cookie，不回退到普通名', async () => {
  const { t, value } = await signedIn(COOKIE);
  (t.env as { BASE_URL: string }).BASE_URL = 'https://test.local';
  expect((await me(t, `__Secure-${COOKIE}=${value}`)).status).toBe(200);
  expect((await me(t, `${COOKIE}=${value}`)).status).toBe(401);
  expect(
    (await me(t, `${COOKIE}=${value}; __Secure-${COOKIE}=forged.AAAA`)).status
  ).toBe(401);
});

it('HTTP 下按普通名读取，与 better-auth 一致', async () => {
  const { t, value, cookie } = await signedIn(COOKIE);
  expect((await me(t, cookie)).status).toBe(200);
  expect((await me(t, `__Secure-${COOKIE}=${value}`)).status).toBe(401);
});

it('签名与令牌不符的 cookie 一律拒绝', async () => {
  const { t, value } = await signedIn(COOKIE);
  const decoded = decodeURIComponent(value);
  const dot = decoded.lastIndexOf('.');
  const sig = decoded.slice(dot + 1);
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  for (const bad of [
    `${decoded.slice(0, dot)}.${flipped}`,
    `${decoded.slice(0, dot)}.not base64!`,
    decoded.slice(0, dot),
  ])
    expect((await me(t, `${COOKIE}=${encodeURIComponent(bad)}`)).status).toBe(
      401
    );
  // A malformed escape is an unknown visitor, not a server error.
  expect((await me(t, `${COOKIE}=%E0%A4%A`)).status).toBe(401);
});

it('临近续期的会话由 get-session 同时延长数据库记录并重新下发 cookie', async () => {
  const t = makeEnv();
  const cookie = await bootstrapAdmin(t);
  // Due for better-auth's sliding refresh: 5 of 7 days left (its update age is 1 day).
  const due = Date.now() + 5 * 24 * 3600_000;
  await t.env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(due).run();
  const expiresAt = async () =>
    (await t.env.DB.prepare('SELECT expires_at FROM sessions').first<{
      expires_at: number;
    }>())!.expires_at;
  // Other requests read the session without touching it.
  expect((await me(t, cookie)).status).toBe(200);
  expect(await expiresAt()).toBe(due);
  const res = await call(t, '/api/auth/get-session', { cookie });
  expect(res.status).toBe(200);
  expect(res.headers.get('set-cookie') ?? '').toMatch(
    /cloudforge\.session_token=[^;]+;.*Max-Age=604800/
  );
  expect(await expiresAt()).toBeGreaterThan(due);
});

it('同一 isolate 内每个环境只创建一个 better-auth 实例', async () => {
  const a = makeEnv();
  const b = makeEnv();
  expect(authFor(a.env)).toBe(authFor(a.env));
  expect(authFor(a.env)).not.toBe(authFor(b.env));
  // Requests keep working through the shared instance.
  const cookie = await bootstrapAdmin(a);
  const res = await call(a, '/api/auth/get-session', { cookie });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ user: { username: 'octocat' } });
});

it('get-session 不计入限流，因此不写 rate_limits；登录仍然计入', async () => {
  const t = makeEnv();
  const cookie = await bootstrapAdmin(t);
  const rows = async () =>
    (await t.env.DB.prepare(
      "SELECT count(*) AS n FROM rate_limits WHERE key LIKE '%get-session%'"
    ).first<{ n: number }>())!.n;
  for (let i = 0; i < 3; i++)
    expect((await call(t, '/api/auth/get-session', { cookie })).status).toBe(
      200
    );
  expect(await rows()).toBe(0);
  const signIns = await t.env.DB.prepare(
    "SELECT count(*) AS n FROM rate_limits WHERE key LIKE '%sign-in%'"
  ).first<{ n: number }>();
  expect(signIns!.n).toBeGreaterThan(0);
});
