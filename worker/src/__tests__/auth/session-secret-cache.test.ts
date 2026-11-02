import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAdmin, call, makeEnv, type TestEnv } from '../helpers/app';

afterEach(() => vi.useRealTimers());

describe('会话签名缓存必须绑定当前密钥', () => {
  it('旧密钥预热后，换密钥的REST与SDK立即一致拒绝，持续访问不能滑动延长旧签名', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t = makeEnv(),
      cookie = await bootstrapAdmin(t);
    const now = Date.now();
    expect((await call(t, '/api/me/preferences', { cookie })).status).toBe(200);
    const rotated: TestEnv = {
      ...t,
      env: {
        ...t.env,
        BETTER_AUTH_SECRET: 'replacement-secret-for-cache-isolation-test-only',
      },
    };
    const sdk = await (
      await call(rotated, '/api/auth/get-session', { cookie })
    ).json();
    const statuses: number[] = [];
    for (const delta of [20_000, 40_000, 60_000]) {
      vi.setSystemTime(now + delta);
      statuses.push(
        (await call(rotated, '/api/me/preferences', { cookie })).status
      );
    }
    console.log(
      '[session-secret-cache-probe]',
      JSON.stringify({ sdk, statuses })
    );
    expect(sdk).toBeNull();
    expect(statuses).toEqual([401, 401, 401]);
    expect((await call(t, '/api/me/preferences', { cookie })).status).toBe(200);
  });
});
