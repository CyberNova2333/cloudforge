import { describe, expect, it } from 'vitest';
import app from '../index';
import { CROSS_SITE_REFUSED, fromAnotherSite } from '../auth/same-origin';
import { bootstrapAdmin, makeEnv, type TestEnv } from './helpers/app';

/** A request to the API as a browser page would send it, with the admin's cookie and the given headers. */
const send = (
  t: TestEnv,
  path: string,
  init: { method?: string; cookie?: string; headers?: Record<string, string> }
) =>
  app.fetch(
    new Request(`http://test.local${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...init.headers,
      },
      body: (init.method ?? 'POST') === 'GET' ? undefined : '{"name":"app"}',
    }),
    t.env,
    t.ctx
  );

describe('跨站请求伪造防护', () => {
  it('来自其他站点、带会话 cookie 的写请求被拒绝', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const res = await send(t, '/api/repos', {
      cookie,
      headers: { Origin: 'http://evil.test.local' },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      CROSS_SITE_REFUSED
    );
    const viaFetchMetadata = await send(t, '/api/repos', {
      cookie,
      headers: { 'Sec-Fetch-Site': 'same-site' },
    });
    expect(viaFetchMetadata.status).toBe(403);
  });

  it('本站页面、非浏览器客户端和读请求照常', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    expect(
      (
        await send(t, '/api/repos', {
          cookie,
          headers: { Origin: 'http://test.local' },
        })
      ).status
    ).toBe(201);
    // No Origin and no Sec-Fetch-Site: not a browser page.
    expect(
      (await send(t, '/api/repos', { cookie, headers: {} })).status
    ).not.toBe(403);
    expect(
      (
        await send(t, '/api/repos', {
          method: 'GET',
          cookie,
          headers: { Origin: 'http://evil.test.local' },
        })
      ).status
    ).toBe(200);
  });

  it('跨站的 WebSocket 升级被拒绝', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const res = await send(t, '/api/live', {
      method: 'GET',
      cookie,
      headers: { Origin: 'http://evil.test.local', Upgrade: 'websocket' },
    });
    expect(res.status).toBe(403);
  });

  it('BASE_URL 的地址也算本站（经别名访问时）', () => {
    const req = (origin: string) =>
      new Request('https://alias.workers.dev/api/repos', {
        method: 'POST',
        headers: { Origin: origin },
      });
    expect(
      fromAnotherSite(req('https://git.example.com'), 'https://git.example.com')
    ).toBe(false);
    expect(
      fromAnotherSite(
        req('https://alias.workers.dev'),
        'https://git.example.com'
      )
    ).toBe(false);
    expect(
      fromAnotherSite(
        req('https://evil.example.com'),
        'https://git.example.com'
      )
    ).toBe(true);
    expect(fromAnotherSite(req('null'), 'https://git.example.com')).toBe(true);
  });
});
