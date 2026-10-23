// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { call, makeEnv } from './helpers/app';

const WELL_KNOWN = '/.well-known/cloudforge';

function withVars(vars: Record<string, string>) {
  const t = makeEnv();
  t.env = { ...t.env, ...vars } as unknown as CloudflareBindings;
  return t;
}

describe('GET /.well-known/cloudforge 安装信息', () => {
  it('安装器从未处理过的实例返回 null 值', async () => {
    const res = await call(makeEnv(), WELL_KNOWN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      installationId: null,
      version: null,
      schemaDigest: null,
    });
  });

  it('从变量和记录中报告安装信息', async () => {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO install_state (installation_id, ownership_nonce, version, manifest_json, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(
        'cloudforge-1a2b3c4d5e6f',
        'n',
        'abc1234',
        '{"schemaDigest":"d1g"}',
        Date.now()
      )
      .run();
    const t = withVars({
      CLOUDFORGE_INSTALLATION:
        '{"installationId":"cloudforge-1a2b3c4d5e6f","ownershipNonce":"n"}',
      CLOUDFORGE_VERSION: 'abc1234',
    });
    const res = await call(t, WELL_KNOWN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      installationId: 'cloudforge-1a2b3c4d5e6f',
      version: 'abc1234',
      schemaDigest: 'd1g',
    });
    expect(JSON.stringify(body)).not.toContain('ownershipNonce');
  });

  it('忽略格式错误的 CLOUDFORGE_INSTALLATION', async () => {
    const res = await call(
      withVars({ CLOUDFORGE_INSTALLATION: 'not json' }),
      WELL_KNOWN
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { installationId: unknown }).installationId
    ).toBeNull();
  });
});
