// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import worker from '../../index';
import { handleGitRequest } from '../../git/http/handler';
import { handleLfsRequest } from '../../lfs/http/handler';
import { call, makeEnv } from '../helpers/app';

async function unavailable(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(response.headers.has('Set-Cookie')).toBe(false);
  expect(await response.text()).toBe('Service temporarily unavailable.\n');
}

it('checks current D1 admission before HTTP authentication and raw Git/LFS, retaining only the metadata probe', async () => {
  const t = makeEnv();
  t.env = {
    ...t.env,
    DB: env.ACCESS_RUNTIME_HTTP_DB,
    CLOUDFORGE_INSTALLATION:
      '{"installationId":"runtime-fixture","ownershipNonce":"never-return-this"}',
    CLOUDFORGE_VERSION: 'bridge-fixture',
  } as unknown as CloudflareBindings;
  // No table and no install marker: even the first installation must remain diagnosable.
  await unavailable(await call(t, '/api/setup/status'));
  const missing = await call(t, '/.well-known/cloudforge');
  expect(missing.status).toBe(200);
  expect(missing.headers.get('Cache-Control')).toBe('no-store');
  expect(await missing.json()).toEqual({
    installationId: 'runtime-fixture',
    version: 'bridge-fixture',
    schemaDigest: null,
    accessRuntime: expect.objectContaining({
      protocol: 1,
      ready: false,
      reason: 'unavailable',
    }),
  });

  await applyD1Migrations(env.ACCESS_RUNTIME_HTTP_DB, env.TEST_D1_MIGRATIONS);
  expect((await call(t, '/api/setup/status')).status).toBe(200);
  expect(
    (
      (await (await call(t, '/.well-known/cloudforge')).json()) as {
        accessRuntime: { ready: boolean };
      }
    ).accessRuntime.ready
  ).toBe(true);

  // The supported update exercises production monotonic/revision triggers, without disabling them.
  await env.ACCESS_RUNTIME_HTTP_DB.prepare(
    'UPDATE access_runtime_state SET minimum_protocol = 2, revision = revision + 1 WHERE id = 1'
  ).run();
  for (const [method, path] of [
    ['GET', '/api/setup/status'],
    ['POST', '/api/auth/sign-in/username'],
    ['GET', '/api/health'],
    ['GET', '/api/repos'],
    ['POST', '/mcp'],
    ['GET', '/.well-known/oauth-authorization-server'],
    ['GET', '/.well-known/cloudforge/'],
    ['POST', '/.well-known/cloudforge'],
    ['OPTIONS', '/.well-known/cloudforge'],
    ['GET', '/api/live'],
  ]) {
    await unavailable(
      await call(t, path, {
        method,
        headers: { Authorization: 'Bearer invalid-but-must-not-be-read' },
      })
    );
  }
  for (const [path, handler] of [
    ['/owner/repo.git/info/refs?service=git-upload-pack', handleGitRequest],
    ['/owner/repo.git/git-receive-pack', handleGitRequest],
    ['/owner/repo.git/info/lfs/objects/batch', handleLfsRequest],
  ] as const) {
    const request = new Request(`http://test.local${path}`, { method: 'POST' });
    await unavailable(await handler(request, t.env, t.ctx));
    await unavailable(
      await worker.fetch(
        request as Parameters<typeof worker.fetch>[0],
        t.env,
        t.ctx
      )
    );
  }
  const probe = await call(t, '/.well-known/cloudforge?diagnostic=1');
  expect(probe.status).toBe(200);
  const body = await probe.json();
  expect(body).toEqual({
    installationId: 'runtime-fixture',
    version: 'bridge-fixture',
    schemaDigest: null,
    accessRuntime: {
      protocol: 1,
      ready: false,
      minimumProtocol: 2,
      schemaMode: 'compat-v1',
      rolePublishingEnabled: false,
      revision: 1,
      reason: 'unsupported',
    },
  });
  expect(JSON.stringify(body)).not.toContain('never-return-this');
  const head = await call(t, '/.well-known/cloudforge', { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.headers.get('Cache-Control')).toBe('no-store');
  expect(await head.text()).toBe('');
  expect(
    await env.ACCESS_RUNTIME_HTTP_DB.prepare(
      'SELECT count(*) AS n FROM users'
    ).first('n')
  ).toBe(0);
});
