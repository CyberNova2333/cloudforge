import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  finishRecentAuthentication,
  pendingRecentAuthentication,
  recentAuthenticationFetch,
  requestRecentAuthentication,
  setRecentAuthenticationSession,
  subscribeRecentAuthentication,
} from './recentAuthentication';

const challenge = (sessionId = 'session-a') =>
  new Response(
    JSON.stringify({ code: 'RECENT_AUTHENTICATION_REQUIRED', sessionId }),
    { status: 403, headers: { 'content-type': 'application/json' } }
  );

let unsubscribe: () => void;
beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://forge.invalid' } });
  setRecentAuthenticationSession('session-a');
  unsubscribe = subscribeRecentAuthentication(() => {});
});
afterEach(() => {
  setRecentAuthenticationSession(null);
  unsubscribe();
  vi.unstubAllGlobals();
});

describe('最近身份验证请求调度', () => {
  it('同一会话并发请求共享一次验证并一起继续', async () => {
    const first = requestRecentAuthentication('session-a');
    const second = requestRecentAuthentication('session-a');
    expect(pendingRecentAuthentication()).toBe('session-a');
    finishRecentAuthentication('session-a', true);
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(pendingRecentAuthentication()).toBeNull();
  });

  it('会话轮换取消原身份的所有待办，旧响应不能验证新会话', async () => {
    const waiting = requestRecentAuthentication('session-a');
    setRecentAuthenticationSession('session-b');
    finishRecentAuthentication('session-a', true);
    expect(await waiting).toBe(false);
    expect(await requestRecentAuthentication('session-a')).toBe(false);
    expect(pendingRecentAuthentication()).toBeNull();
  });

  it('单个请求取消不取消其它请求，全部取消则关闭验证', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const first = requestRecentAuthentication('session-a', a.signal);
    const second = requestRecentAuthentication('session-a', b.signal);
    a.abort();
    expect(await first).toBe(false);
    expect(pendingRecentAuthentication()).toBe('session-a');
    b.abort();
    expect(await second).toBe(false);
    expect(pendingRecentAuthentication()).toBeNull();
  });

  it('取消或界面卸载立即释放待办，没有界面时不挂起请求', async () => {
    const canceled = requestRecentAuthentication('session-a');
    finishRecentAuthentication('session-a', false);
    expect(await canceled).toBe(false);
    const unmounted = requestRecentAuthentication('session-a');
    unsubscribe();
    expect(await unmounted).toBe(false);
    expect(await requestRecentAuthentication('session-a')).toBe(false);
  });
});

describe('敏感请求的受限重试', () => {
  it('只在服务器明确要求且验证成功后重试一次，并绑定原会话', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(challenge());
    vi.stubGlobal('fetch', fetcher);
    const waiting = recentAuthenticationFetch('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test': 'preserved' },
      body: '{"name":"ci"}',
      credentials: 'include',
    });
    await vi.waitFor(() =>
      expect(pendingRecentAuthentication()).toBe('session-a')
    );
    finishRecentAuthentication('session-a', true);
    expect((await waiting).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const retried = fetcher.mock.calls[1][1] as RequestInit;
    expect(new Headers(retried.headers).get('X-CloudForge-Session')).toBe(
      'session-a'
    );
    expect(new Headers(retried.headers).get('X-Test')).toBe('preserved');
    expect(retried.body).toBe('{"name":"ci"}');
    expect(retried.credentials).toBe('include');
    expect(pendingRecentAuthentication()).toBeNull();
  });

  it('验证取消后直接返回原拒绝，不发送写入重试', async () => {
    const fetcher = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal('fetch', fetcher);
    const waiting = recentAuthenticationFetch('/api/tokens', {
      method: 'POST',
    });
    await vi.waitFor(() =>
      expect(pendingRecentAuthentication()).toBe('session-a')
    );
    finishRecentAuthentication('session-a', false);
    expect((await waiting).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['https://external.invalid/api/tokens', {}],
    ['/other', {}],
    ['/api/auth/reauthenticate', { method: 'POST' }],
    [
      '/api/tokens',
      { method: 'POST', body: new URLSearchParams({ name: 'ci' }) },
    ],
  ] as [string, RequestInit][])(
    '不重放外站、重验本身或非字符串正文：%s',
    async (url, init) => {
      const fetcher = vi.fn().mockResolvedValue(challenge());
      vi.stubGlobal('fetch', fetcher);
      expect((await recentAuthenticationFetch(url, init)).status).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(pendingRecentAuthentication()).toBeNull();
    }
  );

  it('不重放带正文的Request，避免消费流后重试', async () => {
    const fetcher = vi.fn().mockResolvedValue(challenge());
    vi.stubGlobal('fetch', fetcher);
    const request = new Request('https://forge.invalid/api/tokens', {
      method: 'POST',
      body: '{"name":"ci"}',
    });
    expect((await recentAuthenticationFetch(request)).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(pendingRecentAuthentication()).toBeNull();
  });

  it('普通拒绝、网络失败和不匹配会话都不弹窗或重试', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":"Forbidden"}', {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(new Error('uncertain result'))
      .mockResolvedValueOnce(challenge('session-other'));
    vi.stubGlobal('fetch', fetcher);
    expect((await recentAuthenticationFetch('/api/tokens')).status).toBe(403);
    await expect(recentAuthenticationFetch('/api/tokens')).rejects.toThrow(
      'uncertain result'
    );
    expect((await recentAuthenticationFetch('/api/tokens')).status).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(pendingRecentAuthentication()).toBeNull();
  });
});
