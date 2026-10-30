import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { OidcError } from '../oidc/errors';
import {
  providerFrom,
  publicProvider,
  authorizationRequest,
  exchangeIdentity,
  randomToken,
  hashValue,
  sealState,
  openState,
  type ProviderConfig,
} from '../oidc/provider';

let rsa: Awaited<ReturnType<typeof generateKeyPair>>;
let ec: Awaited<ReturnType<typeof generateKeyPair>>;
let rsaJwk: JWK;
let ecJwk: JWK;
beforeAll(async () => {
  rsa = await generateKeyPair('RS256');
  ec = await generateKeyPair('ES256');
  rsaJwk = {
    ...(await exportJWK(rsa.publicKey)),
    kid: 'rsa',
    alg: 'RS256',
    use: 'sig',
  };
  ecJwk = {
    ...(await exportJWK(ec.publicKey)),
    kid: 'ec',
    alg: 'ES256',
    use: 'sig',
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function fixture() {
  const issuer = 'https://identity.example/' + crypto.randomUUID();
  const description = {
    id: 'company',
    name: 'Company identity',
    issuer,
    clientId: 'local-client',
    version: 1,
  };
  const bindings = {
    ...env,
    BASE_URL: 'http://test.local',
    OIDC_PROVIDER: JSON.stringify(description),
    OIDC_CLIENT_SECRET: 'test:secret with+space',
  };
  const config = (await providerFrom(bindings))!;
  const input = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    code: 'one-code',
    startedAt: Date.now(),
  };
  const metadata: Record<string, unknown> = {
    issuer,
    authorization_endpoint: issuer + '/authorize',
    token_endpoint: issuer + '/token',
    jwks_uri: issuer + '/jwks',
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    code_challenge_methods_supported: ['S256'],
    response_types_supported: ['code'],
  };
  const jwks: { keys: JWK[] } = { keys: [rsaJwk, ecJwk] };
  const claims: Record<string, unknown> = {
    iss: issuer,
    aud: config.clientId,
    sub: 'stable-subject',
    nonce: input.nonce,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    email: 'member@example.invalid',
    name: 'Member',
  };
  let alg: 'RS256' | 'ES256' = 'RS256';
  let response: Record<string, unknown> | null = null;
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      requests.push({ url: target, init });
      // Construct a native workerd Request before substituting HTTP: this catches unsupported init modes.
      const nativeRequest = new Request(url, init);
      expect(nativeRequest.redirect).toBe('manual');
      expect(init?.redirect).toBe('manual');
      expect(init?.cache).toBe('no-store');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (target === issuer + '/.well-known/openid-configuration')
        return Response.json(metadata);
      if (target === issuer + '/jwks') return Response.json(jwks);
      if (target === issuer + '/token') {
        const token = await new SignJWT(claims)
          .setProtectedHeader({ alg, kid: alg === 'RS256' ? 'rsa' : 'ec' })
          .sign(alg === 'RS256' ? rsa.privateKey : ec.privateKey);
        return Response.json(
          response ?? {
            id_token: token,
            access_token: 'discard-this-token',
            refresh_token: 'discard-this-refresh',
          }
        );
      }
      throw new Error('Unplanned fixture request');
    }
  );
  vi.stubGlobal('fetch', fetcher);
  return {
    issuer,
    description,
    bindings,
    config,
    input,
    metadata,
    jwks,
    claims,
    requests,
    fetcher,
    setAlg: (value: typeof alg) => {
      alg = value;
    },
    setResponse: (value: Record<string, unknown>) => {
      response = value;
    },
  };
}

describe('OIDC 部署配置与状态加密', () => {
  it('未配置关闭；公开DTO不返回secret/digest，secret和公开配置参与摘要', async () => {
    expect(
      await providerFrom({ ...env, BASE_URL: 'http://test.local' })
    ).toBeNull();
    const t = await fixture();
    expect(publicProvider(t.config)).toEqual({
      ...t.description,
      callbackUrl: 'https://test.local/api/auth/oidc/callback/company',
    });
    expect(JSON.stringify(publicProvider(t.config))).not.toMatch(
      /secret|digest/
    );
    expect(
      (await providerFrom({
        ...t.bindings,
        OIDC_CLIENT_SECRET: 'different-secret',
      }))!.digest
    ).not.toBe(t.config.digest);
    expect(
      (await providerFrom({
        ...t.bindings,
        OIDC_PROVIDER: JSON.stringify({ ...t.description, version: 2 }),
      }))!.digest
    ).not.toBe(t.config.digest);
  });
  it.each([
    'http://identity.example',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://private.local',
    'https://intranet',
    'https://u:p@identity.example',
    'https://identity.example?x=1',
    'https://identity.example#fragment',
    'https://0x7f000001',
    'https://identity.example.',
    ' https://identity.example',
    'https://identity.example?',
    'https://identity.example#',
    'https:\\identity.example',
  ])('拒绝不安全issuer %s，错误不带配置', async (issuer) => {
    const t = await fixture();
    await expect(
      providerFrom({
        ...t.bindings,
        OIDC_PROVIDER: JSON.stringify({ ...t.description, issuer }),
      })
    ).rejects.toMatchObject({
      code: 'OIDC_CONFIGURATION_INVALID',
      status: 503,
    });
  });
  it('允许明确origin且稳定排序去重；callback只允许本站固定路径并保留loopback开发HTTP', async () => {
    const t = await fixture();
    const value = await providerFrom({
      ...t.bindings,
      BASE_URL: 'http://127.0.0.1:8080',
      OIDC_PROVIDER: JSON.stringify({
        ...t.description,
        allowedOrigins: ['https://keys.example', 'https://keys.example/'],
      }),
    });
    expect(value!.allowedOrigins).toEqual([
      'https://identity.example',
      'https://keys.example',
    ]);
    expect(value!.callbackUrl).toBe(
      'http://127.0.0.1:8080/api/auth/oidc/callback/company'
    );
    await expect(
      providerFrom({
        ...t.bindings,
        BASE_URL: 'https://user:secret@site.example/',
      })
    ).rejects.toBeInstanceOf(OidcError);
    await expect(
      providerFrom({
        ...t.bindings,
        OIDC_PROVIDER: JSON.stringify({
          ...t.description,
          allowedOrigins: ['https://keys.example/path'],
        }),
      })
    ).rejects.toBeInstanceOf(OidcError);
  });
  it('随机token、SHA256与purpose AES-GCM实际工作，AAD/密钥/篡改不可通用', async () => {
    const t = await fixture();
    const first = randomToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(first);
    expect(await hashValue('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    const payload = { verifier: t.input.verifier, nonce: t.input.nonce };
    const sealed = await sealState(
      t.bindings,
      'action/user/session/provider',
      payload
    );
    expect(sealed).not.toContain(payload.verifier);
    expect(
      await openState(t.bindings, 'action/user/session/provider', sealed)
    ).toEqual(payload);
    expect(
      await sealState(t.bindings, 'action/user/session/provider', payload)
    ).not.toBe(sealed);
    await expect(
      openState(t.bindings, 'different-action', sealed)
    ).rejects.toMatchObject({ code: 'OIDC_STATE_INVALID' });
    await expect(
      openState(
        {
          ...t.bindings,
          BETTER_AUTH_SECRET: 'different-key-not-from-production',
        },
        'action/user/session/provider',
        sealed
      )
    ).rejects.toBeInstanceOf(OidcError);
    await expect(
      openState(
        t.bindings,
        'action/user/session/provider',
        sealed.slice(0, -2) + 'AA'
      )
    ).rejects.toBeInstanceOf(OidcError);
  });
});

describe('OIDC 网络与真实签名协议', () => {
  it('固定S256/state/nonce/scope/callback；client_secret_basic不把secret放URL/正文', async () => {
    const t = await fixture();
    const authorization = new URL(
      await authorizationRequest(t.bindings, t.config, t.input)
    );
    expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
      state: t.input.state,
      nonce: t.input.nonce,
      code_challenge_method: 'S256',
      response_type: 'code',
      scope: 'openid profile email',
      redirect_uri: t.config.callbackUrl,
    });
    expect(authorization.searchParams.get('code_challenge')).not.toBe(
      t.input.verifier
    );
    const before = await env.DB.prepare(
      'SELECT count(*) AS n FROM accounts'
    ).first();
    expect(await exchangeIdentity(t.bindings, t.config, t.input)).toEqual({
      issuer: t.issuer,
      sub: 'stable-subject',
      email: 'member@example.invalid',
      name: 'Member',
      expiresAt: (t.claims.exp as number) * 1000,
    });
    const tokenRequest = t.requests.find((r) => r.url.endsWith('/token'))!;
    expect(tokenRequest.init?.headers).toMatchObject({
      Authorization: 'Basic ' + btoa('local-client:test%3Asecret+with%2Bspace'),
    });
    expect(
      new URLSearchParams(String(tokenRequest.init?.body)).get('code_verifier')
    ).toBe(t.input.verifier);
    expect(String(tokenRequest.init?.body)).not.toContain('secret');
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM accounts').first()
    ).toEqual(before);
  });
  it('ES256通过workerd真实WebCrypto验证，不依赖Node JWT mock', async () => {
    const t = await fixture();
    t.setAlg('ES256');
    expect((await exchangeIdentity(t.bindings, t.config, t.input)).sub).toBe(
      'stable-subject'
    );
  });
  for (const missing of ['iss', 'aud', 'sub', 'exp', 'iat', 'nonce'])
    it(`缺少必填${missing}拒绝`, async () => {
      const t = await fixture();
      delete t.claims[missing];
      await expect(
        exchangeIdentity(t.bindings, t.config, t.input)
      ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    });
  it.each([
    ['wrong issuer', { iss: 'https://wrong.example' }],
    ['wrong audience', { aud: 'wrong-client' }],
    ['wrong nonce', { nonce: 'wrong-nonce' }],
    ['wrong azp', { azp: 'wrong-client' }],
    ['multi aud no azp', { aud: ['local-client', 'other'] }],
    ['multi aud wrong azp', { aud: ['local-client', 'other'], azp: 'other' }],
    ['empty subject', { sub: '' }],
    ['control subject', { sub: 'a\u0000b' }],
  ])('%s拒绝', async (_label, changes) => {
    const t = await fixture();
    Object.assign(t.claims, changes);
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });
  it('多aud且正确azp可验证；过期、未来iat、早于本动作的iat不能蒙混', async () => {
    const t = await fixture();
    t.claims.aud = ['local-client', 'other'];
    t.claims.azp = 'local-client';
    expect((await exchangeIdentity(t.bindings, t.config, t.input)).sub).toBe(
      'stable-subject'
    );
    t.claims.exp = Math.floor(Date.now() / 1000) - 1;
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    t.claims.exp = Math.floor(Date.now() / 1000) + 300;
    t.claims.iat = Math.floor(Date.now() / 1000) + 60;
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    t.claims.iat = Math.floor(Date.now() / 1000) - 60;
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });
  it('无ID token不回退userinfo，原外部token不泄漏进错误', async () => {
    const t = await fixture();
    t.setResponse({ access_token: 'do-not-leak-response' });
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_REQUIRED' });
    expect(t.requests.some((r) => r.url.includes('userinfo'))).toBe(false);
  });
  it.each(['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'])(
    '恶意metadata %s在送出client secret前拒绝',
    async (field) => {
      const t = await fixture();
      t.metadata[field] =
        field === 'issuer' ? t.issuer + '/' : 'https://attacker.example/steal';
      await expect(
        exchangeIdentity(t.bindings, t.config, t.input)
      ).rejects.toBeInstanceOf(OidcError);
      expect(t.requests).toHaveLength(1);
    }
  );
  it('操作员明确允许第二origin；不能借此接受私网端点', async () => {
    const t = await fixture();
    t.metadata.jwks_uri = 'https://127.0.0.1/jwks';
    await expect(
      authorizationRequest(t.bindings, t.config, t.input)
    ).rejects.toBeInstanceOf(OidcError);
  });
  it.each([
    { kty: 'oct', k: 'secret' },
    { ...{ kty: 'RSA', n: 'x', e: 'AQAB' }, d: 'private-key' },
    { kty: 'RSA', n: 'x', e: 'AQAB', jku: 'https://attacker.example' },
  ])('拒绝危险JWK %#', async (key) => {
    const t = await fixture();
    t.jwks.keys = [key];
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_JWKS_INVALID' });
  });
  it('重定向响应不继续跟随；超大流被取消，错误不含响应正文', async () => {
    const t = await fixture();
    t.fetcher.mockImplementationOnce(
      async () =>
        new Response('sensitive-provider-error', {
          status: 302,
          headers: { Location: 'https://attacker.example' },
        })
    );
    await expect(
      authorizationRequest(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_PROVIDER_RESPONSE_INVALID' });
    let cancelled = false;
    t.fetcher.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(65_537));
            },
            cancel() {
              cancelled = true;
            },
          })
        )
    );
    await expect(
      authorizationRequest(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_PROVIDER_RESPONSE_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });
  it('超时覆盖挂起headers，不依赖mock fetch响应AbortSignal', async () => {
    const t = await fixture();
    t.fetcher.mockImplementationOnce(() => new Promise<Response>(() => {}));
    await expect(
      authorizationRequest(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_PROVIDER_TIMEOUT' });
  }, 10_000);
  it('超时覆盖挂起响应body并取消流', async () => {
    const t = await fixture();
    let cancelled = false;
    t.fetcher.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          })
        )
    );
    await expect(
      authorizationRequest(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_PROVIDER_TIMEOUT' });
    expect(cancelled).toBe(true);
  }, 10_000);
  it('签名错误、HS算法与future nbf不得接受', async () => {
    const t = await fixture();
    const other = await generateKeyPair('RS256');
    t.setResponse({
      id_token: await new SignJWT(t.claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'rsa' })
        .sign(other.privateKey),
    });
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    t.setResponse({
      id_token: await new SignJWT(t.claims)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode('12345678901234567890123456789012')),
    });
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    t.setResponse({
      id_token: await new SignJWT({
        ...t.claims,
        nbf: Math.floor(Date.now() / 1000) + 60,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rsa' })
        .sign(rsa.privateKey),
    });
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });
  it('端点明确允许额外origin；未声明S256或仅HS算法失败关闭', async () => {
    const t = await fixture();
    t.metadata.jwks_uri = 'https://keys.example/jwks';
    const c = (await providerFrom({
      ...t.bindings,
      OIDC_PROVIDER: JSON.stringify({
        ...t.description,
        allowedOrigins: ['https://keys.example'],
      }),
    }))!;
    expect(
      new URL(await authorizationRequest(t.bindings, c, t.input)).origin
    ).toBe('https://identity.example');
    const broken = (await providerFrom({
      ...t.bindings,
      OIDC_CLIENT_SECRET: 'second-cache-digest',
    }))!;
    t.metadata.jwks_uri = t.issuer + '/jwks';
    t.metadata.code_challenge_methods_supported = ['plain'];
    await expect(
      authorizationRequest(t.bindings, broken, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_METADATA_INVALID' });
    t.metadata.code_challenge_methods_supported = ['S256'];
    t.metadata.id_token_signing_alg_values_supported = ['HS256'];
    await expect(
      authorizationRequest(t.bindings, broken, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_METADATA_INVALID' });
  });
  it('未知kid在冷却期后有界刷新已完成JWKS', async () => {
    const t = await fixture();
    await exchangeIdentity(t.bindings, t.config, t.input);
    expect(t.requests.filter((r) => r.url.endsWith('/jwks'))).toHaveLength(1);
    const id_token = await new SignJWT(t.claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'rotated' })
      .sign(rsa.privateKey);
    t.setResponse({ id_token });
    t.jwks.keys = [{ ...rsaJwk, kid: 'rotated' }];
    await expect(
      exchangeIdentity(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    expect(t.requests.filter((r) => r.url.endsWith('/jwks'))).toHaveLength(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31_000);
    expect((await exchangeIdentity(t.bindings, t.config, t.input)).sub).toBe(
      'stable-subject'
    );
    expect(t.requests.filter((r) => r.url.endsWith('/jwks'))).toHaveLength(2);
  });
  it('header拒绝后也取消响应流，不留下未读取的provider body', async () => {
    const t = await fixture();
    let cancelled = false;
    t.fetcher.mockImplementationOnce(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'Content-Length': '65537' } }
        )
    );
    await expect(
      authorizationRequest(t.bindings, t.config, t.input)
    ).rejects.toMatchObject({ code: 'OIDC_PROVIDER_RESPONSE_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });
  it('冷启动并发不共享进行中的fetch；后续只复用完成metadata且digest隔离', async () => {
    const t = await fixture();
    const original = t.fetcher.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.fetcher.mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });
    const a = authorizationRequest(t.bindings, t.config, t.input);
    const b = authorizationRequest(t.bindings, t.config, {
      ...t.input,
      state: randomToken(),
    });
    await Promise.resolve();
    expect(t.fetcher).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([a, b]);
    await authorizationRequest(t.bindings, t.config, t.input);
    expect(t.fetcher).toHaveBeenCalledTimes(2);
    const second = (await providerFrom({
      ...t.bindings,
      OIDC_CLIENT_SECRET: 'new-deployment-secret',
    }))!;
    await authorizationRequest(t.bindings, second, t.input);
    expect(t.fetcher).toHaveBeenCalledTimes(3);
  });
});
