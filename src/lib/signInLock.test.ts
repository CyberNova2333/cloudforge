import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nativeSignIn,
  readSignInSession,
  supportsSignInLock,
  withSignInLock,
} from './signInLock';
import { oidcSignInApi } from './oidcSignInApi';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
function locks() {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn(
    (_name: string, _options: unknown, work: () => Promise<unknown>) => {
      const result = tail.then(work);
      tail = result.catch(() => {});
      return result;
    }
  );
  vi.stubGlobal('navigator', { locks: { request } });
  return request;
}
describe('浏览器登录序列与真实会话核对', () => {
  it('不支持锁时SSO拒绝但密码仍可登录，且不会尝试先发SSO请求', async () => {
    vi.stubGlobal('navigator', {});
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => json(null));
    expect(supportsSignInLock()).toBe(false);
    await expect(oidcSignInApi.start('/repos')).rejects.toMatchObject({
      code: 'SIGN_IN_UNSUPPORTED',
    });
    expect(fetcher).not.toHaveBeenCalled();
    const password = vi.fn(async () => ({ data: { ok: true }, error: null }));
    expect(await nativeSignIn(password)).toEqual({
      data: { ok: true },
      error: null,
    });
    expect(password).toHaveBeenCalledOnce();
  });
  it('锁内真实no-store读取发现已登录时不覆盖现有账号', async () => {
    const manager = locks();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        json({ user: { id: 'other-user' }, session: { id: 'other-session' } })
      );
    const password = vi.fn(async () => ({ data: null, error: null }));
    expect(await nativeSignIn(password)).toMatchObject({
      error: { code: 'SESSION_CHANGED' },
    });
    expect(password).not.toHaveBeenCalled();
    expect(manager.mock.calls[0]![0]).toBe('cloudforge.sign-in');
    expect(fetcher.mock.calls[0]![0]).toContain(
      'disableCookieCache=true&disableRefresh=true'
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
    });
  });
  it('密码登录持锁至响应，排队SSO start随后读取新session并拒绝外跳', async () => {
    locks();
    let session: unknown = null;
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => json(session));
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (entered = resolve));
    const first = nativeSignIn(async () => {
      entered();
      await held;
      session = {
        user: { id: 'password-user' },
        session: { id: 'password-session' },
      };
      return { data: true, error: null };
    });
    await started;
    const second = oidcSignInApi.start('/repos');
    expect(fetcher).toHaveBeenCalledTimes(1);
    release();
    await first;
    await expect(second).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.every(([path]) =>
        String(path).startsWith('/api/auth/get-session')
      )
    ).toBe(true);
  });
  it('排队过程中取消不会在锁释放后执行旧登录', async () => {
    locks();
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (entered = resolve));
    const first = withSignInLock(async () => {
      entered();
      await held;
    });
    await started;
    const controller = new AbortController();
    const operation = vi.fn(async () => true);
    const second = withSignInLock(operation, {
      signal: controller.signal,
      required: true,
    });
    controller.abort();
    release();
    await first;
    await expect(second).rejects.toMatchObject({ code: 'SIGN_IN_CANCELLED' });
    expect(operation).not.toHaveBeenCalled();
  });
  it('会话查询失败或缺字段都不能被当作匿名浏览器', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(json({ user: { id: 'member' }, session: {} }));
    await expect(readSignInSession()).rejects.toMatchObject({
      code: 'SIGN_IN_CHECK_FAILED',
    });
    await expect(readSignInSession()).rejects.toMatchObject({
      code: 'SIGN_IN_CHECK_FAILED',
    });
  });
});
