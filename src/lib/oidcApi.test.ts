import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  oidcActionId,
  sameOidcProvider,
  liveOidcPreview,
  candidateOidcAction,
  oidcAuthorizationUrl,
  oidcApi,
  liveOidcRetirement,
  type OidcProvider,
  type OidcAction,
  type OidcRetirementPreview,
} from './oidcApi';

const provider: OidcProvider = {
  id: 'work',
  name: 'Work identity',
  issuer: 'https://identity.example',
  clientId: 'public-client-id',
  version: 1,
  callbackUrl: 'https://forge.example/api/auth/oidc/callback/work',
  loginEnabled: false,
  loginCallbackUrl: null,
};
const actionId = 'f75041f2-bbe1-4b2c-8a9c-2275e07ec05d';
const now = 1_900_000_000_000;
const preview = () => ({
  previewId: 'opaque-preview',
  digest: 'opaque-capability',
  expiresAt: new Date(now + 120_000).toISOString(),
  provider,
});
afterEach(() => vi.restoreAllMocks());

describe('外部身份的临时确认与浏览器请求', () => {
  it('停用预览不需要部署provider，但必须绑定仍启用的D1配置与原代数', () => {
    const active = {
      id: 'work',
      issuer: provider.issuer,
      version: 3,
      generation: 9,
      enabled: true,
      loginEnabled: false,
    };
    const retirement: OidcRetirementPreview = {
      previewId: 'opaque-retirement',
      digest: 'retirement-capability',
      expiresAt: new Date(now + 120000).toISOString(),
      active,
    };
    expect(liveOidcRetirement(retirement, active, now)).toBe(true);
    expect(
      liveOidcRetirement(retirement, { ...active, generation: 10 }, now)
    ).toBe(false);
    expect(
      liveOidcRetirement(retirement, { ...active, enabled: false }, now)
    ).toBe(false);
    expect(
      liveOidcRetirement(retirement, { ...active, loginEnabled: true }, now)
    ).toBe(false);
    expect(
      liveOidcRetirement(
        retirement,
        { ...active, issuer: 'https://other.example' },
        now
      )
    ).toBe(false);
    expect(liveOidcRetirement(retirement, active, now + 120000)).toBe(false);
    expect(liveOidcRetirement(retirement, null, now)).toBe(false);
  });
  it('无部署提供方的停用API仍提交会话头与独立预览能力，不重放未知结果', async () => {
    const active = {
      id: 'work',
      issuer: provider.issuer,
      version: 3,
      generation: 9,
      enabled: true,
      loginEnabled: false,
    };
    const retirement: OidcRetirementPreview = {
      previewId: 'opaque-retirement',
      digest: 'retirement-capability',
      expiresAt: new Date(now + 120000).toISOString(),
      active,
    };
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(retirement), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(new TypeError('Lost retirement response'));
    expect(await oidcApi.retirePreview('session-one')).toEqual(retirement);
    await expect(oidcApi.retire('session-one', retirement)).rejects.toThrow(
      'Lost retirement response'
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![0]).toBe(
      '/api/admin/oidc-provider/retire-preview'
    );
    expect(fetcher.mock.calls[1]![0]).toBe('/api/admin/oidc-provider/retire');
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
      previewId: 'opaque-retirement',
      digest: 'retirement-capability',
    });
    expect(
      new Headers(fetcher.mock.calls[1]![1]!.headers).get(
        'X-CloudForge-Session'
      )
    ).toBe('session-one');
  });
  it('回调只读取单个规范动作UUID，不信任状态、资料或重复参数', () => {
    expect(
      oidcActionId(
        `?oidc_action=${actionId}&oidc_status=confirmed&subject=attacker`
      )
    ).toBe(actionId);
    for (const query of [
      '?oidc_action=javascript:alert(1)',
      '?oidc_action=',
      `?oidc_action=${actionId}&oidc_action=${actionId}`,
      `?oidc_action=${actionId}/extra`,
    ])
      expect(oidcActionId(query)).toBeNull();
  });
  it('预览必须仍绑定完整的公开配置且未过期', () => {
    expect(liveOidcPreview(preview(), provider, now)).toBe(true);
    expect(liveOidcPreview(preview(), provider, now + 120_000)).toBe(false);
    for (const key of [
      'id',
      'name',
      'issuer',
      'clientId',
      'callbackUrl',
    ] as const)
      expect(
        liveOidcPreview(preview(), { ...provider, [key]: 'changed' }, now)
      ).toBe(false);
    expect(liveOidcPreview(preview(), { ...provider, version: 2 }, now)).toBe(
      false
    );
    expect(
      liveOidcPreview(preview(), { ...provider, loginEnabled: true }, now)
    ).toBe(false);
    expect(
      liveOidcPreview(
        preview(),
        { ...provider, loginCallbackUrl: 'https://forge.example/changed' },
        now
      )
    ).toBe(false);
    expect(
      liveOidcPreview({ ...preview(), expiresAt: 'invalid' }, provider, now)
    ).toBe(false);
    expect(liveOidcPreview(preview(), null, now)).toBe(false);
    expect(sameOidcProvider(null, null)).toBe(false);
  });
  it('只有仍有效且含真实返回身份的candidate才能显示确认操作', () => {
    const candidate: OidcAction = {
      sessionId: 's',
      actionId,
      status: 'candidate',
      expiresAt: new Date(now + 1000).toISOString(),
      identity: {
        issuer: provider.issuer,
        subject: 'immutable',
        email: null,
        name: null,
      },
    };
    expect(candidateOidcAction(candidate, now)).toBe(true);
    expect(candidateOidcAction(candidate, now + 1000)).toBe(false);
    for (const status of [
      'pending',
      'confirmed',
      'failed',
      'expired',
      'cancelled',
    ] as const)
      expect(candidateOidcAction({ ...candidate, status }, now)).toBe(false);
    expect(candidateOidcAction({ ...candidate, identity: null }, now)).toBe(
      false
    );
    expect(candidateOidcAction({ ...candidate, expiresAt: null }, now)).toBe(
      false
    );
  });
  it('外跳只接受HTTPS无凭据无fragment地址，额外origin仍由服务器配置检查', () => {
    expect(
      oidcAuthorizationUrl(
        'https://authorization.example/authorize?state=opaque'
      )
    ).toBe('https://authorization.example/authorize?state=opaque');
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,hello',
      '/authorize',
      'http://identity.example/authorize',
      'https://user:secret@identity.example/',
      'https://identity.example/#token',
    ])
      expect(() => oidcAuthorizationUrl(value)).toThrow();
  });
  it('读取结果必须属于当前浏览器会话及原动作', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: 'other',
          provider,
          ready: true,
          bindings: [],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(oidcApi.status('current')).rejects.toThrow('session changed');
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessionId: 'current',
          actionId: 'other-action',
          status: 'confirmed',
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(oidcApi.action('current', actionId)).rejects.toThrow(
      'action changed'
    );
  });
  it('撤销请求只提交绑定ID、revision和显式会话头，不提交外部资料或凭据', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const controller = new AbortController();
    await oidcApi.revoke(
      'session-one',
      {
        id: 'binding-one',
        revision: 7,
        providerId: 'work',
        issuer: provider.issuer,
        subject: 'external-subject',
        email: 'external@example.invalid',
        name: 'External name',
      },
      controller.signal
    );
    const [path, options] = fetcher.mock.calls[0]!;
    expect(path).toBe('/api/me/oidc/revoke');
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    expect(new Headers(options!.headers).get('X-CloudForge-Session')).toBe(
      'session-one'
    );
    expect(JSON.parse(options!.body as string)).toEqual({
      bindingId: 'binding-one',
      revision: 7,
    });
  });
  it('发布与start只发送预览能力，未知网络结果不会自动重放', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"ready":true}', {
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(new TypeError('Lost response'));
    await oidcApi.apply('session-one', { ...preview(), active: null });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      previewId: 'opaque-preview',
      digest: 'opaque-capability',
    });
    await expect(oidcApi.start('session-one', preview())).rejects.toThrow(
      'Lost response'
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
