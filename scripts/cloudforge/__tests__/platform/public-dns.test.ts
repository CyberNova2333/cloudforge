// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { publicDns } from '../../platform/public-dns.ts';

type Answer = { name: string; type: number; data: string };

/** Answers per "<name> <type>"; absent = NOERROR with no answers. */
function doh(
  answers: Record<string, Answer[] | number>,
  seen: { url: URL; headers: Headers }[] = []
) {
  return (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    seen.push({ url: u, headers: new Headers(init?.headers) });
    const a =
      answers[`${u.searchParams.get('name')} ${u.searchParams.get('type')}`];
    if (typeof a === 'number') return Response.json({ Status: a });
    return Response.json({ Status: 0, Answer: a ?? [] });
  }) as unknown as typeof fetch;
}

const noSleep = { sleep: async () => {} };

describe('publicDns：公共 DNS', () => {
  it('向 cloudflare-dns.com 请求 JSON，每种类型查询一次，且不带凭据', async () => {
    const seen: { url: URL; headers: Headers }[] = [];
    await publicDns(doh({}, seen), noSleep).records('mail.example.com');
    expect(seen.map((s) => s.url.searchParams.get('type'))).toEqual([
      'A',
      'AAAA',
      'CNAME',
      'MX',
      'TXT',
    ]);
    for (const s of seen) {
      expect(s.url.origin + s.url.pathname).toBe(
        'https://cloudflare-dns.com/dns-query'
      );
      expect(s.headers.get('accept')).toBe('application/dns-json');
      expect(s.headers.has('authorization')).toBe(false);
    }
  });

  it('仅保留该名称的记录，排除 CNAME 目标名称的记录', async () => {
    const cname = {
      name: 'mail.example.com.',
      type: 5,
      data: 'x.workers.dev.',
    };
    const target = { name: 'x.workers.dev.', type: 1, data: '192.0.2.7' };
    const dns = publicDns(
      doh({
        'mail.example.com A': [cname, target],
        'mail.example.com CNAME': [cname],
      }),
      noSleep
    );
    expect(await dns.records('mail.example.com')).toEqual([
      { type: 'CNAME', content: 'x.workers.dev.' },
    ]);
  });

  it('MX 内容取主机名，TXT 保留带引号的分段，NXDOMAIN 表示无记录', async () => {
    const dns = publicDns(
      doh({
        'example.com MX': [
          {
            name: 'example.com.',
            type: 15,
            data: '10 route1.mx.cloudflare.net.',
          },
          { name: 'example.com.', type: 15, data: '0 .' },
        ],
        'example.com TXT': [
          { name: 'example.com.', type: 16, data: '"v=spf1 " "-all"' },
        ],
        'gone.example.com MX': 3,
      }),
      noSleep
    );
    expect(await dns.records('example.com')).toEqual([
      { type: 'MX', content: 'route1.mx.cloudflare.net.' },
      { type: 'MX', content: '.' },
      { type: 'TXT', content: '"v=spf1 " "-all"' },
    ]);
    expect(await dns.records('gone.example.com')).toEqual([]);
  });

  it('解析器失败时重试，最终错误指出所查名称', async () => {
    let n = 0;
    const flaky = (async () => {
      n++;
      return n < 3
        ? new Response('busy', { status: 503 })
        : Response.json({
            Status: 0,
            Answer: [
              { name: 'example.com.', type: 15, data: '5 mx.example.net.' },
            ],
          });
    }) as unknown as typeof fetch;
    expect(await publicDns(flaky, noSleep).records('example.com')).toEqual([
      { type: 'MX', content: 'mx.example.net.' },
    ]);
    const servfail = publicDns(doh({ 'example.com A': 2 }), noSleep);
    await expect(servfail.records('example.com')).rejects.toThrow(
      'Public DNS lookup of A example.com failed: DNS status 2'
    );
  });
});
