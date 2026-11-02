// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * The request log (`logger()` in index.ts) without the secrets some URLs carry: a password reset's or an
 * invitation's token in the path, and query values such as `?token=` (email verification) or `?code=`. Workers
 * This redacts application log messages. Cloudflare invocation metadata and external log destinations
 * have separate controls; deployment templates disable invocation logs and redact URL queries.
 */
const TOKEN_SEGMENT =
  /(\/(?:reset-password|invites\/token|invite)\/)[^/?#\s]+/g;
const QUERY_PARAM = /([?&])([^=&#\s]+)=([^&#\s]*)/g;

/** `line` (a logged method and path) with token path segments and secret-looking query values replaced. */
export function redactRequestLine(line: string): string {
  const authentication = /\/api\/auth(?:\/|\?|\s)/i.test(line);
  return line
    .replace(TOKEN_SEGMENT, '$1[redacted]')
    .replace(QUERY_PARAM, (match, separator: string, key: string) => {
      let decoded = key;
      try {
        decoded = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        /* Keep malformed keys opaque. */
      }
      const sensitive =
        /token|code|secret|password|key/i.test(decoded) ||
        (authentication && /^state$/i.test(decoded));
      return sensitive ? `${separator}${key}=[redacted]` : match;
    });
}

/** Hono's logger print function, redacted. */
export const redactedLog = (line: string, ...rest: string[]) =>
  console.log(redactRequestLine(line), ...rest);
