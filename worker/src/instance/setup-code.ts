// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * The one-time setup code. `yarn cloudforge install` sets `SETUP_CODE_HASH` (the hash of a code it
 * prints) as a secret; while it is set, the first admin can only be created with the code. Without it,
 * only an instance nobody else can reach (served and configured on a local-only name) is set up without one.
 * The Node CLI computes the same hash: strip dashes and whitespace, upper-case, SHA-256, lowercase hex.
 */

/** Lowercase hex SHA-256 of the code with dashes and whitespace removed, upper-cased. */
export async function setupCodeHash(code: string): Promise<string> {
  const normalised = code.replace(/[\s-]/g, '').toUpperCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalised)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Any env shape: Site admin → Setup passes a partial one. */
function configuredHash(env: object): string {
  const v = (env as { SETUP_CODE_HASH?: unknown }).SETUP_CODE_HASH;
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Whether a setup code is configured (an empty secret counts as unset). */
export function setupCodeRequired(env: object): boolean {
  return configuredHash(env) !== '';
}

/**
 * A name only this machine or its local network resolves, never a deployed instance's: loopback addresses,
 * `localhost`, and the special-use names (`.localhost`, `.local`, `.test`, `.invalid`, `.example`).
 */
export function localOnlyHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h === '::1' ||
    /^127(\.\d{1,3}){3}$/.test(h) ||
    /\.(localhost|local|test|invalid|example)$/.test(h)
  );
}

/**
 * The first admin needs a setup code that isn't configured: no `SETUP_CODE_HASH`, and the instance is reachable
 * beyond this machine (the request or BASE_URL has a public name), so whoever opened it first would own it.
 */
export function setupCodeMissing(env: object, requestUrl: string): boolean {
  if (setupCodeRequired(env)) return false;
  const base = (env as { BASE_URL?: unknown }).BASE_URL;
  const hostOf = (url: unknown) => {
    try {
      return new URL(String(url)).hostname;
    } catch {
      return '';
    }
  };
  return !(
    localOnlyHost(hostOf(requestUrl)) &&
    typeof base === 'string' &&
    localOnlyHost(hostOf(base))
  );
}

/** True when no code is configured (see setupCodeMissing first), or `code` hashes to the configured digest (constant time). */
export async function verifySetupCode(
  env: CloudflareBindings,
  code: string | undefined
): Promise<boolean> {
  const expected = configuredHash(env);
  if (expected === '') return true;
  if (!code) return false;
  const actual = await setupCodeHash(code);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
