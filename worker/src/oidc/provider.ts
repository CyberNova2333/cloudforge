import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { OidcError } from './errors';

export type PublicProvider = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  version: number;
  callbackUrl: string;
  loginEnabled: boolean;
  loginCallbackUrl: string | null;
};
export type OidcPurpose = 'link' | 'login';
export type ProviderConfig = PublicProvider & {
  allowedOrigins: string[];
  secret: string;
  digest: string;
};
type OidcEnv = {
  BASE_URL: string;
  BETTER_AUTH_SECRET: string;
  OIDC_PROVIDER?: string;
  OIDC_CLIENT_SECRET?: string;
};
type State = { verifier: string; nonce: string };
type Metadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  algorithms: ('RS256' | 'ES256')[];
};
const MAX_BYTES = 65_536;
const TIMEOUT_MS = 5_000;
const TTL = 300_000;
const CACHE_LIMIT = 16;
// Only completed, parsed values cross requests. No in-flight promise, Response, stream or crypto import is retained.
const metadataCache = new Map<string, { data: Metadata; at: number }>();
const jwksCache = new Map<string, { data: JSONWebKeySet; at: number }>();
const text = new TextEncoder();
const configSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,49}$/),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    issuer: z.string().min(1).max(2048),
    clientId: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    loginEnabled: z.boolean().optional(),
    allowedOrigins: z.array(z.string().max(2048)).max(8).optional(),
  })
  .strict();
const stateSchema = z
  .object({
    verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  })
  .strict();

function dnsUrl(input: string, originOnly = false) {
  try {
    if (
      /[\u0000-\u0020\u007f\\]/.test(input) ||
      input.includes('#') ||
      /^https:\/\/[^/?#]*@/i.test(input)
    )
      throw new Error();
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const blocked = [
      'localhost',
      'local',
      'localdomain',
      'internal',
      'lan',
      'home',
      'home.arpa',
      'corp',
      'intranet',
      'onion',
    ];
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      host.includes(':') ||
      /^[\d.]+$/.test(host) ||
      !host.includes('.') ||
      host.endsWith('.') ||
      host
        .split('.')
        .some(
          (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
        ) ||
      blocked.some(
        (suffix) => host === suffix || host.endsWith('.' + suffix)
      ) ||
      (originOnly && (url.pathname !== '/' || url.search))
    )
      throw new Error();
    return url;
  } catch {
    throw new OidcError('OIDC_ENDPOINT_INVALID', 503);
  }
}
function endpoint(input: unknown, config: ProviderConfig) {
  if (typeof input !== 'string' || input.length > 2048)
    throw new OidcError('OIDC_METADATA_INVALID', 502);
  const url = dnsUrl(input);
  if (!config.allowedOrigins.includes(url.origin))
    throw new OidcError('OIDC_ENDPOINT_NOT_ALLOWED', 502);
  return url.toString();
}
function callbackUrl(
  baseURL: string,
  id: string,
  purpose: OidcPurpose = 'link'
) {
  const url = new URL(baseURL);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!loopback) {
    url.protocol = 'https:';
  }
  const path = purpose === 'login' ? 'oidc-sign-in' : 'oidc';
  return `${url.origin}/api/auth/${path}/callback/${id}`;
}
export async function providerFrom(
  env: OidcEnv
): Promise<ProviderConfig | null> {
  if (!env.OIDC_PROVIDER?.trim()) return null;
  try {
    if (env.OIDC_PROVIDER.length > 16_384) throw new Error();
    const parsed = configSchema.parse(JSON.parse(env.OIDC_PROVIDER));
    const issuer = dnsUrl(parsed.issuer);
    if (issuer.search || parsed.issuer.includes('?')) throw new Error();
    const secret = env.OIDC_CLIENT_SECRET;
    if (!secret || secret.length > 4096 || /[\u0000-\u001f\u007f]/.test(secret))
      throw new Error();
    const allowedOrigins = [
      ...new Set([
        issuer.origin,
        ...(parsed.allowedOrigins ?? []).map(
          (value) => dnsUrl(value, true).origin
        ),
      ]),
    ].sort();
    // Keep this property order and the disabled digest byte-for-byte compatible with binding-only deployments.
    const bindingConfig = {
      id: parsed.id,
      name: parsed.name,
      issuer: parsed.issuer,
      clientId: parsed.clientId,
      version: parsed.version,
      callbackUrl: callbackUrl(env.BASE_URL, parsed.id),
    };
    const loginEnabled = parsed.loginEnabled === true;
    const publicConfig: PublicProvider = {
      ...bindingConfig,
      loginEnabled,
      loginCallbackUrl: loginEnabled
        ? callbackUrl(env.BASE_URL, parsed.id, 'login')
        : null,
    };
    const digest = await hashValue(
      JSON.stringify({
        ...(loginEnabled ? publicConfig : bindingConfig),
        allowedOrigins,
        secret,
      })
    );
    return { ...publicConfig, allowedOrigins, secret, digest };
  } catch {
    throw new OidcError('OIDC_CONFIGURATION_INVALID', 503);
  }
}
export function publicProvider(config: ProviderConfig): PublicProvider {
  const {
    id,
    name,
    issuer,
    clientId,
    version,
    callbackUrl,
    loginEnabled,
    loginCallbackUrl,
  } = config;
  return {
    id,
    name,
    issuer,
    clientId,
    version,
    callbackUrl,
    loginEnabled,
    loginCallbackUrl,
  };
}
function purposeCallback(config: ProviderConfig, purpose: OidcPurpose) {
  if (purpose === 'link') return config.callbackUrl;
  if (purpose !== 'login') throw new OidcError('OIDC_PURPOSE_INVALID');
  if (config.loginEnabled !== true || !config.loginCallbackUrl)
    throw new OidcError('OIDC_LOGIN_DISABLED', 409);
  return config.loginCallbackUrl;
}
function cached<T>(cache: Map<string, { data: T; at: number }>, key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.at >= 0 && Date.now() - entry.at < TTL)
    return entry;
  cache.delete(key);
  return undefined;
}
function remember<T>(
  cache: Map<string, { data: T; at: number }>,
  key: string,
  data: T
) {
  cache.delete(key);
  while (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, { data, at: Date.now() });
}
async function jsonRequest(
  url: string,
  init: RequestInit = {}
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let body: ReadableStream<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    controller.abort();
    void (reader ? reader.cancel() : body?.cancel())?.catch(() => {});
  };
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          ...init,
          // Workers does not implement redirect:'error'; manual plus status checks never follows a redirect.
          redirect: 'manual',
          cache: 'no-store',
          signal: controller.signal,
        });
        body = response.body;
        if (controller.signal.aborted) {
          cancel();
          throw new OidcError('OIDC_PROVIDER_TIMEOUT', 504);
        }
        if (
          !response.ok ||
          response.redirected ||
          (response.url && response.url !== url)
        )
          throw new OidcError('OIDC_PROVIDER_RESPONSE_INVALID', 502);
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
          throw new OidcError('OIDC_PROVIDER_RESPONSE_TOO_LARGE', 502);
        if (!response.body)
          throw new OidcError('OIDC_PROVIDER_RESPONSE_INVALID', 502);
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BYTES)
            throw new OidcError('OIDC_PROVIDER_RESPONSE_TOO_LARGE', 502);
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
            bytes
          )
        );
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new OidcError('OIDC_PROVIDER_RESPONSE_INVALID', 502);
        return value as Record<string, unknown>;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(new OidcError('OIDC_PROVIDER_TIMEOUT', 504));
        }, TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    cancel();
    throw error instanceof OidcError
      ? error
      : new OidcError('OIDC_PROVIDER_REQUEST_FAILED', 502);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function metadata(config: ProviderConfig) {
  const found = cached(metadataCache, config.digest);
  if (found) return found.data;
  const discovery = endpoint(
    config.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration',
    config
  );
  const value = await jsonRequest(discovery);
  if (
    value.issuer !== config.issuer ||
    !Array.isArray(value.id_token_signing_alg_values_supported)
  )
    throw new OidcError('OIDC_METADATA_INVALID', 502);
  const algorithms = (['RS256', 'ES256'] as const).filter((alg) =>
    (value.id_token_signing_alg_values_supported as unknown[]).includes(alg)
  );
  if (
    !algorithms.length ||
    (value.code_challenge_methods_supported !== undefined &&
      (!Array.isArray(value.code_challenge_methods_supported) ||
        !value.code_challenge_methods_supported.includes('S256'))) ||
    (value.response_types_supported !== undefined &&
      (!Array.isArray(value.response_types_supported) ||
        !value.response_types_supported.includes('code')))
  )
    throw new OidcError('OIDC_METADATA_INVALID', 502);
  const data: Metadata = {
    authorization_endpoint: endpoint(value.authorization_endpoint, config),
    token_endpoint: endpoint(value.token_endpoint, config),
    jwks_uri: endpoint(value.jwks_uri, config),
    algorithms,
  };
  remember(metadataCache, config.digest, data);
  return data;
}
function publicKeys(value: Record<string, unknown>): JSONWebKeySet {
  if (
    !Array.isArray(value.keys) ||
    !value.keys.length ||
    value.keys.length > 32
  )
    throw new OidcError('OIDC_JWKS_INVALID', 502);
  for (const key of value.keys) {
    if (
      !key ||
      typeof key !== 'object' ||
      Array.isArray(key) ||
      ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k', 'jku', 'x5u'].some(
        (field) => field in key
      ) ||
      (key.use !== undefined && key.use !== 'sig') ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) ||
          key.key_ops.length !== 1 ||
          key.key_ops[0] !== 'verify')) ||
      (key.kid !== undefined &&
        (typeof key.kid !== 'string' || key.kid.length > 200)) ||
      !(
        (key.kty === 'RSA' &&
          (key.alg === undefined || key.alg === 'RS256') &&
          typeof key.n === 'string' &&
          typeof key.e === 'string') ||
        (key.kty === 'EC' &&
          (key.alg === undefined || key.alg === 'ES256') &&
          key.crv === 'P-256' &&
          typeof key.x === 'string' &&
          typeof key.y === 'string')
      )
    )
      throw new OidcError('OIDC_JWKS_INVALID', 502);
  }
  return value as unknown as JSONWebKeySet;
}
async function jwks(config: ProviderConfig, url: string) {
  const key = config.digest + ':' + url;
  const found = cached(jwksCache, key);
  if (found) return { ...found, cached: true };
  const data = publicKeys(await jsonRequest(endpoint(url, config)));
  remember(jwksCache, key, data);
  return { data, at: Date.now(), cached: false };
}
export async function authorizationRequest(
  _env: OidcEnv,
  config: ProviderConfig,
  state: State & { state: string },
  purpose: OidcPurpose = 'link'
): Promise<string> {
  const redirectUri = purposeCallback(config, purpose);
  if (
    !stateSchema.safeParse({ verifier: state.verifier, nonce: state.nonce })
      .success ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(state.state)
  )
    throw new OidcError('OIDC_ACTION_INVALID');
  const discovered = await metadata(config);
  const url = new URL(discovered.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state.state);
  url.searchParams.set('nonce', state.nonce);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set(
    'code_challenge',
    base64url(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', text.encode(state.verifier))
      )
    )
  );
  return url.toString();
}
export async function exchangeIdentity(
  _env: OidcEnv,
  config: ProviderConfig,
  input: State & { code: string; startedAt: number },
  purpose: OidcPurpose = 'link'
): Promise<{
  issuer: string;
  sub: string;
  email: string | null;
  name: string | null;
  expiresAt: number;
}> {
  const redirectUri = purposeCallback(config, purpose);
  const now = Date.now();
  if (
    !stateSchema.safeParse({ verifier: input.verifier, nonce: input.nonce })
      .success ||
    !input.code ||
    input.code.length > 8192 ||
    !Number.isSafeInteger(input.startedAt) ||
    input.startedAt > now + 30_000 ||
    now - input.startedAt > 600_000
  )
    throw new OidcError('OIDC_ACTION_INVALID');
  const discovered = await metadata(config);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: redirectUri,
    code_verifier: input.verifier,
  });
  const encode = (value: string) =>
    new URLSearchParams({ v: value }).toString().slice(2);
  const tokens = await jsonRequest(discovered.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization:
        'Basic ' + btoa(encode(config.clientId) + ':' + encode(config.secret)),
    },
    body: form.toString(),
  });
  if (tokens.error !== undefined)
    throw new OidcError('OIDC_PROVIDER_RESPONSE_INVALID', 502);
  if (
    typeof tokens.id_token !== 'string' ||
    !tokens.id_token ||
    tokens.id_token.length > MAX_BYTES
  )
    throw new OidcError('OIDC_ID_TOKEN_REQUIRED', 502);
  try {
    let keys = await jwks(config, discovered.jwks_uri);
    const verify = (data: JSONWebKeySet) =>
      jwtVerify(tokens.id_token as string, createLocalJWKSet(data), {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: discovered.algorithms,
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'],
        clockTolerance: 30,
        maxTokenAge: '10m',
      });
    let verified;
    try {
      verified = await verify(keys.data);
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
      if (
        !keys.cached ||
        Date.now() - keys.at < 30_000 ||
        ![
          'ERR_JWKS_NO_MATCHING_KEY',
          'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
        ].includes(String(code))
      )
        throw error;
      jwksCache.delete(config.digest + ':' + discovered.jwks_uri);
      keys = await jwks(config, discovered.jwks_uri);
      verified = await verify(keys.data);
    }
    const p = verified.payload;
    if (
      typeof p.sub !== 'string' ||
      !p.sub.trim() ||
      p.sub.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(p.sub) ||
      p.nonce !== input.nonce ||
      typeof p.iat !== 'number' ||
      !Number.isSafeInteger(p.iat) ||
      p.iat * 1000 < input.startedAt - 30_000 ||
      p.iat * 1000 > Date.now() + 30_000 ||
      typeof p.exp !== 'number' ||
      !Number.isSafeInteger(p.exp) ||
      !Number.isSafeInteger(p.exp * 1000) ||
      p.exp * 1000 <= Date.now() ||
      p.exp <= p.iat ||
      (Array.isArray(p.aud) && p.aud.length > 1 && p.azp !== config.clientId) ||
      (p.azp !== undefined && p.azp !== config.clientId)
    )
      throw new OidcError('OIDC_ID_TOKEN_INVALID');
    const optionalText = (value: unknown, max: number) =>
      typeof value === 'string' &&
      value.length <= max &&
      !/[\u0000-\u001f\u007f]/.test(value)
        ? value
        : null;
    return {
      issuer: config.issuer,
      sub: p.sub,
      email: optionalText(p.email, 320),
      name: optionalText(p.name, 200),
      expiresAt: p.exp * 1000,
    };
  } catch (error) {
    throw error instanceof OidcError
      ? error
      : new OidcError('OIDC_ID_TOKEN_INVALID');
  }
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function unbase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
    throw new Error();
  const decoded = Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0)
  );
  if (base64url(decoded) !== value) throw new Error();
  return decoded;
}
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export async function hashValue(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(value))),
    (b) => b.toString(16).padStart(2, '0')
  ).join('');
}
async function stateKey(env: OidcEnv) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 16)
    throw new Error();
  const key = await crypto.subtle.importKey(
    'raw',
    text.encode(env.BETTER_AUTH_SECRET),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: text.encode('cloudforge-oidc-v1'),
      info: text.encode('state-aes-gcm'),
    },
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
function stateAdditionalData(aad: string, purpose: OidcPurpose) {
  if (purpose !== 'link' && purpose !== 'login') throw new Error();
  return text.encode(`cloudforge-oidc-${purpose}-state-v1\0` + aad);
}
export async function sealState(
  env: OidcEnv,
  aad: string,
  payload: State,
  purpose: OidcPurpose = 'link'
): Promise<string> {
  try {
    const value = stateSchema.parse(payload);
    if (!aad || aad.length > 4096) throw new Error();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: stateAdditionalData(aad, purpose),
      },
      await stateKey(env),
      text.encode(JSON.stringify(value))
    );
    return 'v1.' + base64url(iv) + '.' + base64url(new Uint8Array(encrypted));
  } catch {
    throw new OidcError('OIDC_STATE_UNAVAILABLE', 503);
  }
}
export async function openState(
  env: OidcEnv,
  aad: string,
  sealed: string,
  purpose: OidcPurpose = 'link'
): Promise<State> {
  try {
    if (!aad || aad.length > 4096 || sealed.length > 2048) throw new Error();
    const [version, ivText, value, extra] = sealed.split('.');
    if (version !== 'v1' || !ivText || !value || extra !== undefined)
      throw new Error();
    const iv = unbase64url(ivText);
    if (iv.length !== 12) throw new Error();
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: stateAdditionalData(aad, purpose),
      },
      await stateKey(env),
      unbase64url(value)
    );
    return stateSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
          decrypted
        )
      )
    );
  } catch {
    throw new OidcError('OIDC_STATE_INVALID');
  }
}
