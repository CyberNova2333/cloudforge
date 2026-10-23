import { expect, it } from 'vitest';
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

it('HTTPS 下按 better-auth 使用的 __Secure- 名读取会话 cookie', async () => {
  const { t, cookie } = await signedIn(`__Secure-${COOKIE}`);
  expect((await me(t, cookie)).status).toBe(200);
});

it('仍可读取普通名，两者同时存在时优先 __Secure- 名', async () => {
  const { t, value, cookie } = await signedIn(COOKIE);
  expect((await me(t, cookie)).status).toBe(200);
  expect(
    (await me(t, `${COOKIE}=${value}; __Secure-${COOKIE}=forged.AAAA`)).status
  ).toBe(401);
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
