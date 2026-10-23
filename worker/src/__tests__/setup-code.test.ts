// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { setupCodeHash } from '../lib/setup-code';
import { countUsers } from '../routers/setup-router';
import { drizzle } from 'drizzle-orm/d1';
import { call, makeEnv, type TestEnv } from './helpers/app';

const CODE = 'ABCD-EFGH-JKMN-PQRS-TUVW';
const admin = {
  name: 'Octo',
  username: 'octocat',
  email: 'octo@example.com',
  password: 'password123',
};

async function withHash(hash: string | undefined) {
  const t = makeEnv();
  (t.env as unknown as Record<string, unknown>).SETUP_CODE_HASH = hash;
  return t;
}
const users = (t: TestEnv) => countUsers(drizzle(t.env.DB) as never);
const post = (t: TestEnv, code?: string) =>
  call(t, '/api/setup', {
    json: code === undefined ? admin : { ...admin, code },
  });

describe('初始化代码', () => {
  it('忽略大小写和短横线，计算小写十六进制 SHA-256', async () => {
    const a = await setupCodeHash(CODE);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await setupCodeHash('abcdefghjkmnpqrstuvw')).toBe(a);
  });

  it('已设置 SETUP_CODE_HASH 且尚无用户时，状态标明需要代码', async () => {
    const t = await withHash(await setupCodeHash(CODE));
    expect(await (await call(t, '/api/setup/status')).json()).toMatchObject({
      setupRequired: true,
      codeRequired: true,
      appName: 'CloudForge',
    });
  });

  it('拒绝未提供代码的初始化', async () => {
    const t = await withHash(await setupCodeHash(CODE));
    expect((await post(t)).status).toBe(403);
    expect(await users(t)).toBe(0);
  });

  it('拒绝错误代码', async () => {
    const t = await withHash(await setupCodeHash(CODE));
    expect((await post(t, 'ABCD-EFGH-JKMN-PQRS-TUVX')).status).toBe(403);
    expect(await users(t)).toBe(0);
  });

  it('接受任意大小写以及带或不带短横线的代码', async () => {
    const t = await withHash(await setupCodeHash(CODE));
    expect((await post(t, 'abcdefghjkmnpqrstuvw')).status).toBe(200);
    expect(await users(t)).toBe(1);
  });

  it('接受粘贴时带有前后或内部空白的代码', async () => {
    const t = await withHash(await setupCodeHash(CODE));
    expect(await setupCodeHash(' abcd-efgh jkmn-pqrs-tuvw \n')).toBe(
      await setupCodeHash(CODE)
    );
    expect((await post(t, ' abcd-efgh-jkmn-pqrs-tuvw \n')).status).toBe(200);
    expect(await users(t)).toBe(1);
  });

  it('站点管理的初始化页面将全空白 SETUP_CODE_HASH 视为未设置', async () => {
    const { runSetupChecks } = await import('../lib/setup-checks');
    const set = await withHash(await setupCodeHash(CODE));
    const blank = await withHash('  \n');
    const detail = async (t: TestEnv) =>
      (await runSetupChecks(t.env, 'http://test.local')).find(
        (c) => c.id === 'secret-setup-code'
      )!.detail;
    expect(await detail(set)).toMatch(/^Set:/);
    expect(await detail(blank)).toMatch(/^Not set:/);
  });

  it('空 SETUP_CODE_HASH 视为未设置', async () => {
    const t = await withHash('');
    expect(
      (
        (await (await call(t, '/api/setup/status')).json()) as {
          codeRequired: boolean;
        }
      ).codeRequired
    ).toBe(false);
    expect((await post(t)).status).toBe(200);
  });

  it('管理员已存在时 codeRequired 为 false，且初始化保持关闭', async () => {
    const t = await withHash(await setupCodeHash(CODE));
    expect((await post(t, CODE)).status).toBe(200);
    const s = (await (await call(t, '/api/setup/status')).json()) as {
      setupRequired: boolean;
      codeRequired: boolean;
    };
    expect(s.setupRequired).toBe(false);
    expect(s.codeRequired).toBe(false);
    expect((await post(t, CODE)).status).toBe(403);
  });
});
