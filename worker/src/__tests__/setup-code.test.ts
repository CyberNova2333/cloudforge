// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { localOnlyHost, setupCodeHash } from '../lib/setup-code';
import { countUsers, SETUP_CODE_MISSING } from '../routers/setup-router';
import app from '../index';
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

describe('未设置初始化代码的实例', () => {
  /** An instance without SETUP_CODE_HASH whose BASE_URL is `base`. */
  const at = (base: string) => {
    const t = makeEnv();
    (t.env as unknown as Record<string, unknown>).BASE_URL = base;
    return t;
  };
  const status = async (t: TestEnv) =>
    (await (await call(t, '/api/setup/status')).json()) as {
      codeRequired: boolean;
      codeMissing: boolean;
    };

  it('只有本机或保留域名算作仅本地可达', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      'app.localhost',
      'test.local',
      'git.test',
    ])
      expect(localOnlyHost(h), h).toBe(true);
    for (const h of [
      'git.example.com',
      'cloudforge.workers.dev',
      '10.0.0.5',
      'localhost.example.com',
      '127.0.0.1.nip.io',
    ])
      expect(localOnlyHost(h), h).toBe(false);
  });

  it('BASE_URL 为公网地址时拒绝初始化，并在状态中说明缺少代码', async () => {
    const t = at('https://git.example.com');
    expect(await status(t)).toMatchObject({
      codeRequired: false,
      codeMissing: true,
    });
    const res = await post(t);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      SETUP_CODE_MISSING
    );
    expect(await users(t)).toBe(0);
  });

  it('请求来自公网地址时同样拒绝，即使 BASE_URL 是本机地址', async () => {
    const t = at('http://localhost:8080');
    const res = await app.fetch(
      new Request('https://cloudforge.workers.dev/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://cloudforge.workers.dev',
        },
        body: JSON.stringify(admin),
      }),
      t.env,
      t.ctx
    );
    expect(res.status).toBe(403);
    expect(await users(t)).toBe(0);
  });

  it('本机实例无需代码即可初始化', async () => {
    const t = makeEnv();
    expect(await status(t)).toMatchObject({ codeMissing: false });
    expect((await post(t)).status).toBe(200);
    expect(await users(t)).toBe(1);
  });

  it('设置了代码后，公网实例凭代码初始化', async () => {
    const t = at('https://git.example.com');
    (t.env as unknown as Record<string, unknown>).SETUP_CODE_HASH =
      await setupCodeHash(CODE);
    expect(await status(t)).toMatchObject({
      codeRequired: true,
      codeMissing: false,
    });
    expect((await post(t, CODE)).status).toBe(200);
  });
});

describe('首位管理员的创建是原子的', () => {
  it('同时提交的两次初始化只有一次成功', async () => {
    const t = makeEnv();
    const results = await Promise.all([
      post(t),
      call(t, '/api/setup', {
        json: {
          ...admin,
          username: 'mallory',
          email: 'mallory@example.com',
        },
      }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await users(t)).toBe(1);
  });

  it('另一个请求正在创建时返回 409，过期的占用可以被接管', async () => {
    const t = makeEnv();
    const claim = (at: number) =>
      t.env.DB.prepare(
        "INSERT INTO instance_settings (key, value, updated_at) VALUES ('setup.claim', '{}', ?) ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at"
      )
        .bind(at)
        .run();
    await claim(Math.floor(Date.now() / 1000));
    expect((await post(t)).status).toBe(409);
    expect(await users(t)).toBe(0);
    await claim(Math.floor(Date.now() / 1000) - 120);
    expect((await post(t)).status).toBe(200);
    expect(await users(t)).toBe(1);
  });
});
