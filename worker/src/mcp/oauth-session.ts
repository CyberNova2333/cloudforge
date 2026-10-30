// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, eq, isNull, sql } from 'drizzle-orm';
import { verifyJwsAccessToken } from 'better-auth/oauth2';
import { mcpResource, oauthIssuer } from '../auth';
import { oauthConsents, users } from '../db/auth.schema';
import { agents, oauthGrantGenerations } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import {
  OAUTH_GRANT_CLAIM,
  currentGrantReference,
  validGrantReference,
} from '../auth/oauth-grants';
import { POLICY_VERSION_SQL } from '../auth/policy';
import type { AppEnv, SessionUser } from '../variables';

type Auth = AppEnv['Variables']['auth'];
type Jwks = Awaited<ReturnType<Auth['api']['getJwks']>>;

/** How long an isolate reuses the public signing keys (a D1 read each time otherwise, on every /mcp request). */
export const JWKS_TTL_MS = 5 * 60_000;
const jwksCache = new WeakMap<Auth, { jwks: Jwks; until: number }>();

/** The JWKS, from this isolate's copy while fresh; `fresh` reads it again (a new signing key, say). */
async function jwksOf(auth: Auth, fresh: boolean): Promise<Jwks> {
  const hit = jwksCache.get(auth);
  if (!fresh && hit && hit.until > Date.now()) return hit.jwks;
  const jwks = await auth.api.getJwks();
  jwksCache.set(auth, { jwks, until: Date.now() + JWKS_TTL_MS });
  return jwks;
}

export interface McpSession {
  user: SessionUser;
  clientId: string;
  scopes: string[];
}

/**
 * Bearer JWT → user, verified locally against our JWKS. Also requires an unbanned user who isn't an
 * agent and the app's consent row, so disconnecting an app takes effect immediately.
 */
export async function getMcpSession(
  auth: AppEnv['Variables']['auth'],
  db: DrizzleDB,
  baseURL: string,
  headers: Headers
): Promise<McpSession | null> {
  const header = headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const verify = (fresh: boolean) =>
    verifyJwsAccessToken(match[1], {
      jwksFetch: () => jwksOf(auth, fresh),
      verifyOptions: {
        // The plugin signs `iss` from the configured base URL but advertises it upgraded to https.
        issuer: [
          `${baseURL.replace(/\/$/, '')}/api/auth`,
          oauthIssuer(baseURL),
        ],
        audience: mcpResource(baseURL),
      },
    });
  let payload: Record<string, unknown>;
  try {
    payload = await verify(false);
  } catch {
    // Perhaps signed with a key newer than this isolate's copy: once more with the keys read again.
    try {
      payload = await verify(true);
    } catch {
      return null;
    }
  }
  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  const clientId =
    typeof payload.azp === 'string'
      ? payload.azp
      : typeof payload.client_id === 'string'
        ? payload.client_id
        : null;
  if (!userId || !clientId) return null;

  const reference = payload[OAUTH_GRANT_CLAIM];
  if (reference !== undefined && !validGrantReference(reference)) return null;
  // One authority read: a disconnect cannot be observed between separate consent/generation queries.
  const row = await db
    .select({
      user: users,
      grant: oauthGrantGenerations,
      policyVersion: sql<number>`${sql.raw(POLICY_VERSION_SQL)}`,
    })
    .from(users)
    .innerJoin(
      oauthConsents,
      and(
        eq(oauthConsents.userId, users.id),
        eq(oauthConsents.clientId, clientId),
        reference !== undefined
          ? eq(oauthConsents.referenceId, reference)
          : undefined
      )
    )
    .leftJoin(
      oauthGrantGenerations,
      and(
        eq(oauthGrantGenerations.userId, users.id),
        eq(oauthGrantGenerations.clientId, clientId)
      )
    )
    .leftJoin(agents, eq(agents.userId, users.id))
    .where(and(eq(users.id, userId), isNull(agents.userId)))
    .get();
  if (!row || row.user.banned) return null;
  if (
    !currentGrantReference(
      reference,
      row.policyVersion,
      row.grant?.generation,
      row.grant?.legacyRevoked
    )
  )
    return null;
  const scope = typeof payload.scope === 'string' ? payload.scope : '';
  return {
    user: row.user as SessionUser,
    clientId,
    scopes: scope.split(' ').filter(Boolean),
  };
}
