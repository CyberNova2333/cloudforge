/**
 * The request log (`logger()` in index.ts) without the secrets some URLs carry: a password reset's or an
 * invitation's token in the path, and query values such as `?token=` (email verification) or `?code=`. Workers
 * Logs keep every line (observability samples all requests), so the token never reaches them.
 */
const TOKEN_SEGMENT =
  /(\/(?:reset-password|invites\/token|invite)\/)[^/?#\s]+/g;
const SECRET_PARAM =
  /([?&](?:[^=&#\s]*(?:token|code|secret|password|key)[^=&#\s]*)=)[^&#\s]*/gi;

/** `line` (a logged method and path) with token path segments and secret-looking query values replaced. */
export function redactRequestLine(line: string): string {
  return line
    .replace(TOKEN_SEGMENT, '$1[redacted]')
    .replace(SECRET_PARAM, '$1[redacted]');
}

/** Hono's logger print function, redacted. */
export const redactedLog = (line: string, ...rest: string[]) =>
  console.log(redactRequestLine(line), ...rest);
