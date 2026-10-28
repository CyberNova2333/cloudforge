// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { addMember, bootstrapAdmin, call, makeEnv } from './helpers/app';
import { AUTH_BODY_LIMIT } from '../index';

/** A JSON array of `n` numbers: about 2n bytes, every element invalid for a string schema. */
const numbers = (n: number) => Array(n).fill(0);

describe('请求体大小与数组上限', () => {
  it('匿名的 OAuth 客户端注册超过上限时在解析前以 413 拒绝', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const contacts = numbers(AUTH_BODY_LIMIT);
    const res = await call(t, '/api/auth/oauth2/register', {
      json: { redirect_uris: ['https://app.example/cb'], contacts },
    });
    expect(res.status).toBe(413);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('正常大小的 OAuth 客户端注册不受影响', async () => {
    const t = makeEnv();
    await bootstrapAdmin(t);
    const res = await call(t, '/api/auth/oauth2/register', {
      json: {
        redirect_uris: ['http://127.0.0.1:8976/callback'],
        client_name: 'Test app',
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.status).toBeLessThan(300);
  });

  it('受保护分支列表超过 50 条时返回 400，超大请求体返回 413', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'shared', visibility: 'internal' },
    });
    const bob = await addMember(t, admin, 'bob');
    const tooMany = await call(t, '/api/repos/octocat/shared', {
      cookie: admin,
      method: 'PATCH',
      json: {
        protectedBranches: Array.from({ length: 51 }, (_, i) => `b${i}`),
      },
    });
    expect(tooMany.status).toBe(400);
    // Refused before validation, so before the permission check too: a reader gets the same answer.
    const huge = await call(t, '/api/repos/octocat/shared', {
      cookie: bob,
      method: 'PATCH',
      json: { protectedBranches: numbers(600_000) },
    });
    expect(huge.status).toBe(413);
  });

  it('校验错误信息最多列出 10 条', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'shared', visibility: 'internal' },
    });
    const res = await call(t, '/api/repos/octocat/shared', {
      cookie: admin,
      method: 'PATCH',
      json: { protectedBranches: numbers(40) },
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error.split('; ')).toHaveLength(10);
  });
});
