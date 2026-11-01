import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loginReturnTo,
  oidcSignInApi,
  signInActionId,
  signInReturnTo,
  type OidcSignInAction,
} from './oidcSignInApi';

const id = 'f75041f2-bbe1-4b2c-8a9c-2275e07ec05d';
const action: OidcSignInAction = {
  actionId: id,
  status: 'ready',
  expiresAt: '2030-01-01T00:00:00Z',
  provider: { id: 'work', name: 'Work', issuer: 'https://identity.example' },
  user: { id: 'member-a', name: 'A', username: 'alice' },
  factorRequired: true,
  returnTo: '/repos',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
beforeEach(() =>
  vi.stubGlobal('navigator', {
    locks: {
      request: (
        _name: string,
        _options: unknown,
        work: () => Promise<unknown>
      ) => work(),
    },
  })
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('SSO登录收据与站内继续地址', () => {
  it('仅接受公共UUID动作索引，不信任重复参数与状态声明', () => {
    expect(signInActionId('?actionId=' + id + '&status=signed_in')).toBe(id);
    expect(signInActionId('?actionId=' + id + '&actionId=' + id)).toBeNull();
    expect(signInActionId('?actionId=attacker')).toBeNull();
  });
  it('站内SPA和原始签名OAuth继续地址可用，其余API和完成页自循环不可用', () => {
    const signed =
      '/api/auth/oauth2/authorize?client_id=a&sig=raw%2Fsignature&state=a%2Bb';
    expect(signInReturnTo('/octocat/repo#readme')).toBe('/octocat/repo#readme');
    expect(signInReturnTo(signed)).toBe(signed);
    expect(loginReturnTo(signed.slice(signed.indexOf('?')))).toBe(signed);
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil',
      '/api/auth/sign-out',
      '/api/me/oidc',
      '/login/oidc',
      '/login/oidc?return_to=/',
      '/api/auth/oauth2/authorize?client_id=a',
      '/api/auth/oauth2/authorize?client_id=a&sig=b#fragment',
    ])
      expect(signInReturnTo(value)).toBeNull();
    expect(loginReturnTo('?return_to=https%3A%2F%2Fevil.example')).toBe('/');
  });
  it('本地因子只向自有complete提交，不给SDK密码挑战、不自动重放错误', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        String(url).startsWith('/api/auth/get-session')
          ? json(null)
          : json(
              {
                code: 'INVALID_TOTP_CODE',
                error: 'sensitive-raw-provider-error',
              },
              401
            )
      );
    await expect(
      oidcSignInApi.complete(action, { method: 'totp', code: '123456' })
    ).rejects.toMatchObject({
      code: 'INVALID_TOTP_CODE',
      message:
        'Single sign-on could not be completed. Check its status or sign in with your password.',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]![0]).toBe('/api/auth/oidc-sign-in/complete');
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
      actionId: id,
      method: 'totp',
      code: '123456',
    });
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('/two-factor/'))
    ).toBe(false);
  });
  it('signed_in收据必须与真实cookie的userId及sessionId都一致', async () => {
    const receipt = {
      ...action,
      status: 'signed_in' as const,
      sessionId: 'session-a',
    };
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        json({ user: { id: 'member-a' }, session: { id: 'session-a' } })
      )
      .mockResolvedValueOnce(
        json({ user: { id: 'member-b' }, session: { id: 'session-a' } })
      )
      .mockResolvedValueOnce(json(null));
    expect(await oidcSignInApi.destination(receipt)).toBe('/repos');
    await expect(oidcSignInApi.destination(receipt)).rejects.toMatchObject({
      code: 'SESSION_CHANGED',
    });
    await expect(oidcSignInApi.destination(receipt)).rejects.toMatchObject({
      code: 'SESSION_CHANGED',
    });
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).startsWith('/api/auth/get-session')
      )
    ).toBe(true);
  });
  it('读取到不同动作或不安全继续地址时不接受收据', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ ...action, actionId: 'different' }))
      .mockResolvedValueOnce(
        json({ ...action, returnTo: 'https://evil.example' })
      );
    await expect(oidcSignInApi.action(id)).rejects.toMatchObject({
      code: 'OIDC_SIGN_IN_CHANGED',
    });
    await expect(oidcSignInApi.action(id)).rejects.toMatchObject({
      code: 'OIDC_SIGN_IN_CHANGED',
    });
  });
  it('未知complete网络结果不自动重发恢复码', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(null))
      .mockRejectedValueOnce(new TypeError('Lost response'));
    await expect(
      oidcSignInApi.complete(action, {
        method: 'recovery_code',
        code: 'one-use',
      })
    ).rejects.toThrow('Lost response');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
