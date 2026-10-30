import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticationPolicyReturn,
  currentPolicyPreview,
  matchesAuthenticationPolicy,
  reportAuthenticationPolicyChallenge,
  subscribeAuthenticationPolicy,
  type AuthenticationPolicyPreview,
} from './authenticationPolicy';
import { recentAuthenticationFetch } from './recentAuthentication';

afterEach(() => vi.unstubAllGlobals());
const state = {
  sessionId: 'session-a',
  policy: { version: 3, requireMfa: true },
  access: 'full',
  enrolled: true,
};
describe('浏览器强制认证策略状态', () => {
  it('只接受预期会话的完整权威状态，不靠本地绑定状态猜测权限', () => {
    expect(matchesAuthenticationPolicy(state, 'session-a')).toBe(true);
    expect(matchesAuthenticationPolicy(state, 'session-b')).toBe(false);
    for (const value of [
      null,
      {},
      { ...state, access: 'admin' },
      { ...state, enrolled: 1 },
      { ...state, policy: { version: -1, requireMfa: true } },
      { ...state, policy: { version: 1.2, requireMfa: true } },
      { ...state, policy: { version: 0, requireMfa: 'false' } },
    ])
      expect(matchesAuthenticationPolicy(value, 'session-a')).toBe(false);
  });
  it('策略拒绝只通知对应会话重新读取，不把响应内容当成full权限', () => {
    const listener = vi.fn();
    const stop = subscribeAuthenticationPolicy(listener);
    try {
      expect(
        reportAuthenticationPolicyChallenge({
          code: 'AUTHENTICATION_POLICY_REQUIRED',
          sessionId: 'session-a',
          access: 'enroll_mfa',
        })
      ).toBe(true);
      expect(listener).toHaveBeenCalledWith('session-a');
      expect(
        reportAuthenticationPolicyChallenge({
          code: 'AUTHENTICATION_POLICY_REQUIRED',
          sessionId: 'session-a',
          access: 'full',
        })
      ).toBe(false);
      expect(
        reportAuthenticationPolicyChallenge({
          code: 'AUTHENTICATION_POLICY_REQUIRED',
          sessionId: '',
          access: 'reauthenticate',
        })
      ).toBe(false);
      expect(
        reportAuthenticationPolicyChallenge({
          code: 'FORBIDDEN',
          sessionId: 'session-a',
          access: 'reauthenticate',
        })
      ).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
  it('策略挑战不会重放已阻止的业务请求，即使有可复用正文', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://forge.invalid' } });
    const listener = vi.fn();
    const stop = subscribeAuthenticationPolicy(listener);
    const response = () =>
      new Response(
        JSON.stringify({
          code: 'AUTHENTICATION_POLICY_REQUIRED',
          sessionId: 'session-a',
          access: 'reauthenticate',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      );
    const fetcher = vi.fn().mockImplementation(response);
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(
        (
          await recentAuthenticationFetch('/api/tokens', {
            method: 'POST',
            body: '{"name":"never-replay"}',
          })
        ).status
      ).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('session-a');
    } finally {
      stop();
    }
  });
  it('不能重放的流式请求也只刷新策略，外站同名错误不会触发刷新', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://forge.invalid' } });
    const listener = vi.fn();
    const stop = subscribeAuthenticationPolicy(listener);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Response(
            JSON.stringify({
              code: 'AUTHENTICATION_POLICY_REQUIRED',
              sessionId: 'session-a',
              access: 'enroll_mfa',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } }
          )
      )
    );
    try {
      await recentAuthenticationFetch('/api/upload', {
        method: 'POST',
        body: new URLSearchParams({ x: 'y' }),
      });
      await recentAuthenticationFetch('https://external.invalid/api/upload');
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
});

describe('策略预览和续接', () => {
  const preview = {
    target: { requireMfa: true },
    policy: { version: 2, requireMfa: false },
    expiresAt: '2026-10-28T12:02:00Z',
  } as AuthenticationPolicyPreview;
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('预览只有目标、当前版本和有效期都匹配时可确认', () => {
    expect(currentPolicyPreview(preview, true, 2, now)).toBe(true);
    expect(currentPolicyPreview(preview, false, 2, now)).toBe(false);
    expect(currentPolicyPreview(preview, true, 3, now)).toBe(false);
    expect(currentPolicyPreview(preview, true, 2, now + 120_000)).toBe(false);
    expect(
      currentPolicyPreview({ ...preview, expiresAt: 'invalid' }, true, 2, now)
    ).toBe(false);
    expect(currentPolicyPreview(null, true, 2, now)).toBe(false);
  });
  it('绑定和重验保留原始签名查询，普通路径保留查询与定位', () => {
    const signed =
      '/api/auth/oauth2/authorize?client_id=abc&state=a%2Bb&sig=raw%2Fvalue';
    const query = '?return_to=' + encodeURIComponent(signed);
    expect(authenticationPolicyReturn('/settings/security', query, '')).toBe(
      signed
    );
    expect(authenticationPolicyReturn('/login/verify', query, '')).toBe(signed);
    expect(
      authenticationPolicyReturn('/owner/repo', '?tab=code', '#readme')
    ).toBe('/owner/repo?tab=code#readme');
  });
  it('绑定页不能借续接参数转向外站或反斜线地址', () => {
    for (const target of [
      '//external.invalid',
      '/\\external.invalid',
      'https://external.invalid',
      '/\n//external.invalid',
    ])
      expect(
        authenticationPolicyReturn(
          '/settings/security',
          '?return_to=' + encodeURIComponent(target),
          ''
        )
      ).toBe('/');
  });
});
