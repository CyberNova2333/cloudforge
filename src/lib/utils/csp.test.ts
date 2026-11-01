import { describe, expect, it } from 'vitest';
import indexHtml from '../../../index.html?raw';
import headers from '../../../public/_headers?raw';

/** The Content-Security-Policy that public/_headers sets on every page. */
function policy(): Map<string, string[]> {
  const line = headers
    .split('\n')
    .find((l) => l.trim().startsWith('Content-Security-Policy:'));
  if (!line) throw new Error('public/_headers 未设置 Content-Security-Policy');
  const value = line.slice(line.indexOf(':') + 1);
  return new Map(
    value
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name!, sources])
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

describe('页面的内容安全策略', () => {
  it('允许 index.html 中的主题启动脚本（按哈希），且不允许其他内联脚本', async () => {
    const inline = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1]!
    );
    expect(inline).toHaveLength(1);
    const scripts = policy().get('script-src')!;
    expect(scripts).toEqual(["'self'", await sha256(inline[0]!)]);
  });

  it('禁止插件、<base>、被嵌入和向其他站点提交表单', () => {
    const p = policy();
    expect(p.get('object-src')).toEqual(["'none'"]);
    expect(p.get('base-uri')).toEqual(["'none'"]);
    expect(p.get('frame-ancestors')).toEqual(["'none'"]);
    expect(p.get('form-action')).toEqual(["'self'"]);
    expect(p.get('connect-src')).toEqual(["'self'"]);
  });

  it('每行不超过 Cloudflare 的 2000 字符限制', () => {
    for (const line of headers.split('\n'))
      expect(line.length).toBeLessThanOrEqual(2000);
  });
});
