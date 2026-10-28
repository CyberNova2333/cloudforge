import { describe, expect, it } from 'vitest';
import type { OAuthOptions, Scope } from '@better-auth/oauth-provider';
import { authFor } from '../auth';
import { bootstrapAdmin, call, makeEnv, type TestEnv } from './helpers/app';
import {
  ORIGIN,
  REDIRECT,
  authorize,
  connect,
  pkce,
  raw,
  rpc,
} from './helpers/mcp';

function providerOptions(t: TestEnv) {
  const plugin = authFor(t.env).options.plugins.find(
    (p) => p.id === 'oauth-provider'
  );
  return plugin!.options as OAuthOptions<Scope[]>;
}

function pauseClaims(
  t: TestEnv,
  grant: 'authorization_code' | 'refresh_token'
) {
  const claims = providerOptions(t).extensions![0].claims!;
  const original = claims.accessToken!;
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let paused = false;
  claims.accessToken = async (input) => {
    if (!paused && input.grantType === grant) {
      paused = true;
      entered();
      await held;
    }
    return original(input);
  };
  return {
    reached,
    release,
    restore: () => {
      claims.accessToken = original;
    },
  };
}

function refresh(t: TestEnv, clientId: string, refreshToken: string) {
  return raw(t, '/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource: `${ORIGIN}/mcp`,
    }),
  });
}

async function issueCode(
  t: TestEnv,
  cookie: string,
  clientId: string,
  clientSecret?: string,
  withResource = true
) {
  const { verifier, challenge } = await pkce();
  const response = await raw(
    t,
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'openid profile email offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(withResource ? { resource: `${ORIGIN}/mcp` } : {}),
    })}`,
    { headers: { Cookie: cookie }, redirect: 'manual' }
  );
  expect(response.status).toBe(302);
  let callback = new URL(response.headers.get('Location')!, ORIGIN);
  if (callback.pathname === '/oauth/consent') {
    const consent = await call(t, '/api/auth/oauth2/consent', {
      cookie,
      json: { accept: true, oauth_query: callback.search.slice(1) },
    });
    expect(consent.status).toBe(200);
    callback = new URL(((await consent.json()) as { url: string }).url);
  }
  expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT);
  return () =>
    raw(t, '/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        redirect_uri: REDIRECT,
        code: callback.searchParams.get('code')!,
        code_verifier: verifier,
        ...(withResource ? { resource: `${ORIGIN}/mcp` } : {}),
      }),
    });
}

async function legacyConnection(t: TestEnv, admin: string) {
  const options = providerOptions(t);
  const { postLogin, extensions } = options;
  // Mint the pre-migration provider's real tokens and rows; the production verifier stays unchanged.
  options.postLogin = undefined;
  options.extensions = undefined;
  try {
    return await connect(t, admin);
  } finally {
    options.postLogin = postLogin;
    options.extensions = extensions;
  }
}

describe('OAuth 断开后的授权代际回归复现', () => {
  it('重新同意同一应用后，之前已经撤销的 JWT 仍须失效', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const old = await connect(t, admin);
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(200);

    const disconnected = await call(t, `/api/mcp/connections/${old.clientId}`, {
      cookie: admin,
      method: 'DELETE',
    });
    expect(disconnected.status).toBe(200);
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(401);

    const renewed = await authorize(t, admin, old.clientId);
    expect((await rpc(t, renewed.access_token, 'ping')).status).toBe(200);
    const oldStatus = (await rpc(t, old.access_token, 'ping')).status;
    expect(oldStatus).toBe(401);
  });

  it('原生删除同意记录也永久撤销旧 JWT', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const old = await connect(t, admin);
    const consent = await t.env.DB.prepare(
      'SELECT id FROM oauth_consents WHERE client_id = ?'
    )
      .bind(old.clientId)
      .first<{ id: string }>();
    expect(
      (
        await call(t, '/api/auth/oauth2/delete-consent', {
          cookie: admin,
          json: { id: consent!.id },
        })
      ).status
    ).toBe(200);
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(401);
    const renewed = await authorize(t, admin, old.clientId);
    expect((await rpc(t, renewed.access_token, 'ping')).status).toBe(200);
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(401);
  });

  for (const legacy of [false, true])
    for (const opaque of [false, true])
      it(`原生用户资料的GET与POST都拒绝已撤销的${legacy ? '旧版' : '新版'}${opaque ? 'opaque' : 'JWT'}凭据`, async () => {
        const t = makeEnv();
        const admin = await bootstrapAdmin(t);
        const old = legacy
          ? await legacyConnection(t, admin)
          : await connect(t, admin);
        let oldToken = old.access_token;
        if (opaque) {
          const options = providerOptions(t);
          const { postLogin, extensions } = options;
          if (legacy) {
            options.postLogin = undefined;
            options.extensions = undefined;
          }
          try {
            const exchange = await issueCode(
              t,
              admin,
              old.clientId,
              undefined,
              false
            );
            const issued = await exchange();
            expect(issued.status).toBe(200);
            oldToken = ((await issued.json()) as { access_token: string })
              .access_token;
            expect(oldToken.split('.')).toHaveLength(1);
          } finally {
            options.postLogin = postLogin;
            options.extensions = extensions;
          }
        }
        const userinfo = (token: string, transport: 'GET' | 'POST' | 'form') =>
          raw(t, '/api/auth/oauth2/userinfo', {
            method: transport === 'GET' ? 'GET' : 'POST',
            headers: {
              ...(transport === 'form'
                ? {}
                : { Authorization: `Bearer ${token}` }),
              ...(transport === 'GET'
                ? {}
                : { 'Content-Type': 'application/x-www-form-urlencoded' }),
            },
            ...(transport === 'GET'
              ? {}
              : {
                  body: new URLSearchParams(
                    transport === 'form' ? { access_token: token } : {}
                  ),
                }),
          });
        for (const transport of ['GET', 'POST', 'form'] as const)
          expect((await userinfo(oldToken, transport)).status).toBe(200);
        expect(
          (
            await call(t, `/api/mcp/connections/${old.clientId}`, {
              cookie: admin,
              method: 'DELETE',
            })
          ).status
        ).toBe(200);
        for (const transport of ['GET', 'POST', 'form'] as const)
          expect((await userinfo(oldToken, transport)).status).toBe(401);
        const renewed = await authorize(t, admin, old.clientId);
        let renewedToken = renewed.access_token;
        if (opaque) {
          const exchange = await issueCode(
            t,
            admin,
            old.clientId,
            undefined,
            false
          );
          const issued = await exchange();
          expect(issued.status).toBe(200);
          renewedToken = ((await issued.json()) as { access_token: string })
            .access_token;
          expect(renewedToken.split('.')).toHaveLength(1);
        }
        for (const transport of ['GET', 'POST', 'form'] as const) {
          expect((await userinfo(renewedToken, transport)).status).toBe(200);
          expect((await userinfo(oldToken, transport)).status).toBe(401);
        }
      });

  for (const legacy of [false, true])
    for (const opaque of [false, true])
      it(`原生内省使撤销后的${legacy ? '旧版' : '新版'}${opaque ? 'opaque' : 'JWT'}失效并保留新刷新凭据`, async () => {
        const t = makeEnv();
        const admin = await bootstrapAdmin(t);
        const registered = await raw(t, '/api/auth/oauth2/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Confidential introspection client',
            redirect_uris: [REDIRECT],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_post',
          }),
        });
        expect(registered.status).toBe(201);
        const { client_id: clientId, client_secret: clientSecret } =
          (await registered.json()) as {
            client_id: string;
            client_secret: string;
          };
        let latestRefresh = '';
        const issue = async (legacyMode = false) => {
          const options = providerOptions(t);
          const { postLogin, extensions } = options;
          if (legacyMode) {
            options.postLogin = undefined;
            options.extensions = undefined;
          }
          try {
            const exchange = await issueCode(
              t,
              admin,
              clientId,
              clientSecret,
              !opaque
            );
            const response = await exchange();
            expect(response.status).toBe(200);
            const tokens = (await response.json()) as {
              access_token: string;
              refresh_token: string;
            };
            latestRefresh = tokens.refresh_token;
            return tokens.access_token;
          } finally {
            options.postLogin = postLogin;
            options.extensions = extensions;
          }
        };
        const introspect = async (token: string, hint = 'access_token') => {
          const response = await raw(t, '/api/auth/oauth2/introspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              token,
              token_type_hint: hint,
            }),
          });
          expect(response.status).toBe(200);
          return (await response.json()) as { active: boolean };
        };
        const old = await issue(legacy);
        expect(old.split('.')).toHaveLength(opaque ? 1 : 3);
        const initial = await introspect(old);
        expect(initial.active).toBe(true);
        if (!legacy)
          expect(initial).toHaveProperty(
            'cf_grant',
            expect.stringMatching(/^cf-grant-v1:[a-f0-9]{32}$/)
          );
        expect((await introspect(latestRefresh, 'refresh_token')).active).toBe(
          true
        );
        expect(
          (
            await call(t, `/api/mcp/connections/${clientId}`, {
              cookie: admin,
              method: 'DELETE',
            })
          ).status
        ).toBe(200);
        expect((await introspect(old)).active).toBe(false);
        const renewed = await issue();
        expect((await introspect(renewed)).active).toBe(true);
        expect((await introspect(latestRefresh, 'refresh_token')).active).toBe(
          true
        );
        expect((await introspect(old)).active).toBe(false);
      });

  it('旧版无代际 JWT 与刷新凭据继续工作，但首次撤销后重连不复活', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const old = await legacyConnection(t, admin);
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(200);
    const rotated = await refresh(t, old.clientId, old.refresh_token!);
    expect(rotated.status).toBe(200);
    const rotatedJwt = ((await rotated.json()) as { access_token: string })
      .access_token;
    expect((await rpc(t, rotatedJwt, 'ping')).status).toBe(200);
    expect(
      (
        await call(t, `/api/mcp/connections/${old.clientId}`, {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    const renewed = await authorize(t, admin, old.clientId);
    expect((await rpc(t, renewed.access_token, 'ping')).status).toBe(200);
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(401);
    expect((await rpc(t, rotatedJwt, 'ping')).status).toBe(401);
    expect((await refresh(t, old.clientId, old.refresh_token!)).status).toBe(
      400
    );
  });

  it('活跃连接重复授权保持稳定代际，跳过同意的授权码仍可换票', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const first = await connect(t, admin);
    const exchange = await issueCode(t, admin, first.clientId);
    const token = await exchange();
    expect(token.status).toBe(200);
    const second = ((await token.json()) as { access_token: string })
      .access_token;
    expect((await rpc(t, first.access_token, 'ping')).status).toBe(200);
    expect((await rpc(t, second, 'ping')).status).toBe(200);
    expect(
      await t.env.DB.prepare(
        'SELECT count(*) AS n FROM oauth_consents WHERE client_id = ?'
      )
        .bind(first.clientId)
        .first<number>('n')
    ).toBe(1);
  });

  it('旧 consent 原地升级且保留旧凭据，不生成重复的连接记录', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const old = await legacyConnection(t, admin);
    const before = await t.env.DB.prepare(
      'SELECT id FROM oauth_consents WHERE client_id = ?'
    )
      .bind(old.clientId)
      .first<string>('id');
    const exchange = await issueCode(t, admin, old.clientId);
    const current = await exchange();
    expect(current.status).toBe(200);
    expect((await rpc(t, old.access_token, 'ping')).status).toBe(200);
    expect((await refresh(t, old.clientId, old.refresh_token!)).status).toBe(
      200
    );
    const consents = await t.env.DB.prepare(
      'SELECT id, reference_id FROM oauth_consents WHERE client_id = ?'
    )
      .bind(old.clientId)
      .all<{ id: string; reference_id: string }>();
    expect(consents.results).toHaveLength(1);
    expect(consents.results[0].id).toBe(before);
    expect(consents.results[0].reference_id).toMatch(
      /^cf-grant-v1:[a-f0-9]{32}$/
    );
    const connections = await call(t, '/api/mcp/connections', {
      cookie: admin,
    });
    expect(await connections.json()).toHaveLength(1);
  });

  for (const legacy of [false, true]) {
    it(`${legacy ? '旧版' : '新版'}刷新已读入但尚未签发时断开并重连，原刷新必须被拒`, async () => {
      const t = makeEnv();
      const admin = await bootstrapAdmin(t);
      const old = legacy
        ? await legacyConnection(t, admin)
        : await connect(t, admin);
      const held = pauseClaims(t, 'refresh_token');
      const pending = refresh(t, old.clientId, old.refresh_token!);
      try {
        await held.reached;
        expect(
          (
            await call(t, `/api/mcp/connections/${old.clientId}`, {
              cookie: admin,
              method: 'DELETE',
            })
          ).status
        ).toBe(200);
        const renewed = await authorize(t, admin, old.clientId);
        expect((await rpc(t, renewed.access_token, 'ping')).status).toBe(200);
        held.release();
        expect((await pending).status).toBe(400);
        expect((await rpc(t, old.access_token, 'ping')).status).toBe(401);
      } finally {
        held.release();
        held.restore();
        await pending;
      }
    });
  }

  it('授权码已经读入但尚未签发时断开并重连，原授权码不能继承新代际', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const old = await connect(t, admin);
    const exchange = await issueCode(t, admin, old.clientId);
    const held = pauseClaims(t, 'authorization_code');
    const pending = exchange();
    try {
      await held.reached;
      expect(
        (
          await call(t, `/api/mcp/connections/${old.clientId}`, {
            cookie: admin,
            method: 'DELETE',
          })
        ).status
      ).toBe(200);
      const renewed = await authorize(t, admin, old.clientId);
      expect((await rpc(t, renewed.access_token, 'ping')).status).toBe(200);
      held.release();
      expect((await pending).status).toBe(400);
    } finally {
      held.release();
      held.restore();
      await pending;
    }
  });

  it('旧代际的迟到 consent、refresh 与 opaque access 实际写入均被 D1 拒绝', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const old = await connect(t, admin);
    const consent = (await t.env.DB.prepare(
      'SELECT user_id, reference_id FROM oauth_consents WHERE client_id = ?'
    )
      .bind(old.clientId)
      .first<{ user_id: string; reference_id: string }>())!;
    expect(
      (
        await call(t, `/api/mcp/connections/${old.clientId}`, {
          cookie: admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    await authorize(t, admin, old.clientId);
    await expect(
      t.env.DB.prepare(
        'INSERT INTO oauth_consents (id, client_id, user_id, reference_id, scopes) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(
          'stale-consent',
          old.clientId,
          consent.user_id,
          consent.reference_id,
          '[]'
        )
        .run()
    ).rejects.toThrow('OAuth authorization was revoked');
    await expect(
      t.env.DB.prepare(
        'INSERT INTO oauth_refresh_tokens (id, token, client_id, user_id, reference_id, scopes) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(
          'stale-refresh',
          'unused-stale-token',
          old.clientId,
          consent.user_id,
          consent.reference_id,
          '[]'
        )
        .run()
    ).rejects.toThrow('OAuth authorization was revoked');
    await expect(
      t.env.DB.prepare(
        'INSERT INTO oauth_access_tokens (id, token, client_id, user_id, reference_id, scopes) VALUES (?, ?, ?, ?, ?, ?)'
      )
        .bind(
          'stale-access',
          'unused-stale-access-token',
          old.clientId,
          consent.user_id,
          consent.reference_id,
          '[]'
        )
        .run()
    ).rejects.toThrow('OAuth authorization was revoked');
  });

  it('撤权事务失败时同时回滚 consent 删除和代际轮换，删除客户端也不产生孤儿', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const current = await connect(t, admin);
    await expect(
      t.env.DB.batch([
        t.env.DB.prepare('DELETE FROM oauth_consents WHERE client_id = ?').bind(
          current.clientId
        ),
        t.env.DB.prepare(
          'INSERT INTO oauth_grant_generations (user_id, client_id, generation) VALUES (?, ?, ?)'
        ).bind('missing-user', current.clientId, 'bad'),
      ])
    ).rejects.toThrow();
    expect((await rpc(t, current.access_token, 'ping')).status).toBe(200);
    await t.env.DB.prepare('DELETE FROM oauth_clients WHERE client_id = ?')
      .bind(current.clientId)
      .run();
    expect((await rpc(t, current.access_token, 'ping')).status).toBe(401);
    expect(
      await t.env.DB.prepare(
        'SELECT count(*) AS n FROM oauth_grant_generations WHERE client_id = ?'
      )
        .bind(current.clientId)
        .first<number>('n')
    ).toBe(0);
  });
});
