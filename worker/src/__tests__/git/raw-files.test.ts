// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { bootstrapAdmin, call, makeEnv } from '../helpers/app';
import { commitFiles } from '../helpers/seed';

const SANDBOX = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

async function setup(files: Record<string, string>) {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  await call(t, '/api/repos', {
    cookie: admin,
    json: { name: 'app', addReadme: true, visibility: 'internal' },
  });
  await commitFiles([...t.fake.repos.values()][0], 'main', files, 'Add files');
  return (path: string) =>
    call(t, `/api/repos/octocat/app/raw?ref=main&path=${path}`, {
      cookie: admin,
    });
}

describe('原始文件端点', () => {
  it('以沙箱图片方式提供 SVG，使 Markdown 的 <img> 标签正常显示', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>';
    const raw = await setup({ 'logo.svg': svg, 'BADGE.SVG': svg });
    for (const path of ['logo.svg', 'BADGE.SVG']) {
      const res = await raw(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      // Opened directly, the SVG's script can't run on our origin.
      expect(res.headers.get('Content-Security-Policy')).toBe(SANDBOX);
      expect(await res.text()).toBe(svg);
    }
  });

  it('不将 HTML 作为文档提供，并对所有原始文件应用沙箱限制', async () => {
    const raw = await setup({
      'page.html': '<script>alert(1)</script>',
      'notes.txt': 'hi',
    });
    for (const path of ['page.html', 'notes.txt']) {
      const res = await raw(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).not.toMatch(/html|svg/);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe(SANDBOX);
    }
  });
});
