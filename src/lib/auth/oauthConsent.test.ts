// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import OAuthConsent from '../../pages/auth/OAuthConsent';
import {
  finishRecentAuthentication,
  pendingRecentAuthentication,
  setRecentAuthenticationSession,
  subscribeRecentAuthentication,
} from './recentAuthentication';

// Exercise the actual page's event handler in the existing workerd environment.
// UI/query hooks are inert; the page and its real session-bound fetch wrapper run unchanged.
const state = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [initial, state.update],
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === 'oauth-client'
        ? { client_name: 'Example client' }
        : { tools: [] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@primer/octicons-react', () => ({
  EyeIcon: 'EyeIcon',
  PencilIcon: 'PencilIcon',
  PersonIcon: 'PersonIcon',
  PlugIcon: 'PlugIcon',
  SyncIcon: 'SyncIcon',
}));
vi.mock('@/lib/api/uiApi', () => ({
  api: { mcp: vi.fn() },
  qk: { mcp: ['mcp'] },
}));
vi.mock('@/lib/api/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth/auth', () => ({
  useCurrentUser: () => ({ username: 'alice' }),
}));
vi.mock('@/lib/utils/appName', () => ({ useAppName: () => 'CloudForge' }));
vi.mock('@/lib/i18n/i18n', () => ({
  t: (value: string) => value,
  tx: (value: string) => value,
}));
vi.mock('@/components/ui/Avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('@/components/ui/Notice', () => ({ Notice: 'Notice' }));
vi.mock('@/components/ui/PendingButton', () => ({
  PendingButton: 'PendingButton',
}));
vi.mock('@/components/shell/SetFrame', () => ({
  RowsSkeleton: 'RowsSkeleton',
}));
vi.mock('../../pages/auth/AuthShell', () => ({ AuthShell: 'AuthShell' }));

const query =
  '?client_id=client-a&scope=openid%20offline_access&sig=signed%2Bquery';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const challenge = () =>
  json({ code: 'RECENT_AUTHENTICATION_REQUIRED', sessionId: 'session-a' }, 403);
const redirect = 'https://client.example/callback?code=issued';
let unsubscribe: () => void;
beforeEach(() => {
  vi.stubGlobal('window', {
    location: {
      origin: 'https://forge.invalid',
      search: query,
      href: 'https://forge.invalid/oauth/consent' + query,
    },
  });
  state.update.mockClear();
  setRecentAuthenticationSession('session-a');
  unsubscribe = subscribeRecentAuthentication(() => {});
});
afterEach(() => {
  setRecentAuthenticationSession(null);
  unsubscribe();
  vi.unstubAllGlobals();
});

function buttonAction(accept = true) {
  let action: (() => Promise<void>) | undefined;
  function visit(node: ReactNode) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as ReactElement<{
      children?: ReactNode;
      onClick?: () => Promise<void>;
    }>;
    if ((element.type as unknown) === (accept ? 'PendingButton' : 'button'))
      action = element.props.onClick;
    visit(element.props.children);
  }
  visit(OAuthConsent());
  expect(action).toBeTypeOf('function');
  return action!();
}

describe('OAuthConsent 页面近期认证续接', () => {
  it('允许按钮在明确403后打开重验，仅以原签名请求及原会话重试一次', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(json({ url: redirect }));
    vi.stubGlobal('fetch', fetcher);
    const action = buttonAction();
    await vi.waitFor(() =>
      expect(pendingRecentAuthentication()).toBe('session-a')
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    finishRecentAuthentication('session-a', true);
    await action;
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [path, init] of fetcher.mock.calls) {
      expect(path).toBe('/api/auth/oauth2/consent');
      expect(init.credentials).toBe('include');
      expect(JSON.parse(init.body)).toEqual({
        accept: true,
        oauth_query: query.slice(1),
      });
    }
    expect(
      new Headers(fetcher.mock.calls[1][1].headers).get('X-CloudForge-Session')
    ).toBe('session-a');
    expect(window.location.href).toBe(redirect);
  });

  it('重试仍403时显示错误，不再弹窗或第三次提交', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(
        json(
          {
            code: 'RECENT_AUTHENTICATION_REQUIRED',
            sessionId: 'session-a',
            message: 'Verify again',
          },
          403
        )
      );
    vi.stubGlobal('fetch', fetcher);
    const action = buttonAction();
    await vi.waitFor(() =>
      expect(pendingRecentAuthentication()).toBe('session-a')
    );
    finishRecentAuthentication('session-a', true);
    await action;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pendingRecentAuthentication()).toBeNull();
    expect(state.update).toHaveBeenCalledWith('Verify again');
    expect(window.location.href).toContain('/oauth/consent');
  });

  it.each(['cancel', 'account-switch'])(
    '%s 关闭待办后不重新同意或跳转',
    async (reason) => {
      const fetcher = vi.fn().mockResolvedValueOnce(challenge());
      vi.stubGlobal('fetch', fetcher);
      const action = buttonAction();
      await vi.waitFor(() =>
        expect(pendingRecentAuthentication()).toBe('session-a')
      );
      if (reason === 'account-switch')
        setRecentAuthenticationSession('session-b');
      else finishRecentAuthentication('session-a', false);
      finishRecentAuthentication('session-a', true);
      await action;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(pendingRecentAuthentication()).toBeNull();
      expect(window.location.href).toContain('/oauth/consent');
      expect(state.update).toHaveBeenLastCalledWith(null);
    }
  );

  it('拒绝按钮直接提交拒绝并续接，不提示重验', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ url: redirect + '&error=access_denied' }));
    vi.stubGlobal('fetch', fetcher);
    await buttonAction(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      accept: false,
      oauth_query: query.slice(1),
    });
    expect(pendingRecentAuthentication()).toBeNull();
    expect(window.location.href).toContain('error=access_denied');
  });
});
