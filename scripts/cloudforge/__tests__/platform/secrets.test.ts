// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyticsTokenLink,
  checkAnalyticsToken,
  checkR2Keys,
  generateAuthSecret,
  generateSetupCode,
  r2TokenLink,
  setupCodeHash,
  withSecretsFile,
} from '../../platform/secrets.ts';

describe('初始化码', () => {
  it('与 Worker 的规范化方式一致', () => {
    const hex = createHash('sha256')
      .update('ABCDEFGHJKMNPQRSTUVW')
      .digest('hex');
    expect(setupCodeHash('abcd-efgh-jkmn-pqrs-tuvw')).toBe(
      setupCodeHash('ABCDEFGHJKMNPQRSTUVW')
    );
    expect(setupCodeHash('ABCDEFGHJKMNPQRSTUVW')).toBe(hex);
    // Whitespace anywhere is ignored too (a pasted code), as in the Worker.
    expect(setupCodeHash(' abcd-efgh jkmn-pqrs-tuvw \n')).toBe(hex);
  });
  it('符合文档格式', () => {
    for (let i = 0; i < 50; i++)
      expect(generateSetupCode()).toMatch(
        /^([A-HJKMNP-Z2-9]{4}-){4}[A-HJKMNP-Z2-9]{4}$/
      );
  });
  it('身份验证密钥为 64 位十六进制随机字符串', () => {
    expect(generateAuthSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateAuthSecret()).not.toBe(generateAuthSecret());
  });
});

describe('withSecretsFile：临时密钥文件', () => {
  it('写入权限为 0600 的 JSON 文件，结束后删除', async () => {
    let p = '';
    const out = await withSecretsFile({ A: 'x', B: 'y' }, async (path) => {
      p = path;
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
        A: 'x',
        B: 'y',
      });
      return 7;
    });
    expect(out).toBe(7);
    expect(existsSync(p)).toBe(false);
  });
  it('fn 抛出错误时删除文件', async () => {
    let p = '';
    await expect(
      withSecretsFile({ A: 'x' }, async (path) => {
        p = path;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(existsSync(p)).toBe(false);
  });
});

describe('令牌链接', () => {
  it('R2 链接在创建页面预选对象写入权限', () => {
    const u = new URL(r2TokenLink('acc123', ['b1', 'b2']));
    expect(u.searchParams.get('to')).toBe('/acc123/r2/api-tokens/create');
    expect(u.searchParams.get('permission')).toBe('object-write');
  });
  it('分析令牌链接属于账户并具有读取权限', () => {
    const u = new URL(analyticsTokenLink('acc123', 'cloudforge'));
    expect(u.searchParams.get('to')).toBe('/acc123/api-tokens');
    expect(JSON.parse(u.searchParams.get('permissionGroupKeys')!)).toEqual([
      { key: 'account_analytics', type: 'read' },
    ]);
  });
});

describe('凭据检查', () => {
  const keys = { id: 'AKID', secret: 'SECRETSECRET' };
  it('R2 返回 403 时给出消息，返回 200 时给出 null', async () => {
    const f = (s: number) =>
      (async () => new Response('', { status: s })) as unknown as typeof fetch;
    expect(await checkR2Keys('a', 'b', keys, f(403))).toBe(
      'R2 rejected these keys (HTTP 403).'
    );
    expect(await checkR2Keys('a', 'b', keys, f(200))).toBeNull();
  });
  it('R2 网络错误不会抛出异常或泄露密钥', async () => {
    const f = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const m = await checkR2Keys('a', 'b', keys, f);
    expect(m).toContain("Couldn't reach R2");
    expect(m).toContain('offline');
    expect(m).not.toContain(keys.secret);
  });
  it('分析接口：错误返回消息，账户返回 null', async () => {
    const f = (body: object) =>
      (async () => Response.json(body)) as unknown as typeof fetch;
    const msg = "This token can't read Account Analytics for this account.";
    expect(
      await checkAnalyticsToken('a', 'tok', f({ errors: [{ message: 'x' }] }))
    ).toBe(msg);
    expect(
      await checkAnalyticsToken(
        'a',
        'tok',
        f({ data: { viewer: { accounts: [] } } })
      )
    ).toBe(msg);
    expect(
      await checkAnalyticsToken(
        'a',
        'tok',
        f({ data: { viewer: { accounts: [{ accountTag: 'a' }] } } })
      )
    ).toBeNull();
  });
});
