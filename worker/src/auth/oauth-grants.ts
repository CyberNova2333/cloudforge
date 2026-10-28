import {
  getOAuthProviderState,
  type OAuthOptions,
  type Scope,
} from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import type { GenericEndpointContext } from '@better-auth/core';
import { isCurrentSession, readSessionAuthentication } from './assurance';

export const OAUTH_GRANT_CLAIM = 'cf_grant';
export const OAUTH_GRANT_PREFIX = 'cf-grant-v1:';

/** References are server-generated and inherited by authorization codes and every refresh rotation. */
export function validGrantReference(value: unknown): value is string {
  return typeof value === 'string' && /^cf-grant-v1:[a-f0-9]{32}$/.test(value);
}

function invalidGrant(): never {
  throw new APIError('BAD_REQUEST', {
    error: 'invalid_grant',
    error_description:
      'The application authorization was revoked. Connect again.',
  });
}

/** Grant generations are independent of browser credential changes, preserving existing OAuth semantics. */
async function referenceFor(
  env: CloudflareBindings,
  userId: string,
  clientId: string
) {
  await env.DB.prepare(
    `INSERT INTO oauth_grant_generations (user_id, client_id, generation, legacy_revoked)
    VALUES (?, ?, ?, 0) ON CONFLICT (user_id, client_id) DO NOTHING`
  )
    .bind(userId, clientId, crypto.randomUUID().replaceAll('-', ''))
    .run();
  const row = await env.DB.prepare(
    'SELECT generation FROM oauth_grant_generations WHERE user_id = ? AND client_id = ?'
  )
    .bind(userId, clientId)
    .first<{ generation: string }>();
  const reference = row && `${OAUTH_GRANT_PREFIX}${row.generation}`;
  if (!validGrantReference(reference)) invalidGrant();
  // Upgrade the existing grant in place: preserve its scopes/moderator link and avoid duplicate connected apps.
  // Legacy JWTs/refresh tokens remain unversioned until an explicit revocation leaves the permanent tombstone.
  await env.DB.prepare(
    `UPDATE oauth_consents SET reference_id = ? WHERE user_id = ? AND client_id = ?
    AND reference_id IS NULL AND EXISTS (SELECT 1 FROM oauth_grant_generations g
      WHERE g.user_id = oauth_consents.user_id AND g.client_id = oauth_consents.client_id
      AND ? = '${OAUTH_GRANT_PREFIX}' || g.generation AND g.legacy_revoked = 0)`
  )
    .bind(reference, userId, clientId, reference)
    .run();
  return reference;
}

/** Never relabel an old code/refresh with a new grant: read its original reference, then compare. */
async function assertGrant(
  env: CloudflareBindings,
  userId: string,
  clientId: string,
  reference: string | undefined
) {
  if (reference !== undefined && !validGrantReference(reference))
    invalidGrant();
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM users u
    LEFT JOIN oauth_grant_generations g ON g.user_id = u.id AND g.client_id = ?
    WHERE u.id = ? AND COALESCE(u.banned, 0) = 0
    AND NOT EXISTS (SELECT 1 FROM agents WHERE user_id = u.id)
    AND EXISTS (SELECT 1 FROM oauth_consents c WHERE c.user_id = u.id AND c.client_id = ?
      AND (? IS NULL OR c.reference_id = ?))
    AND ((? IS NULL AND COALESCE(g.legacy_revoked, 0) = 0)
      OR (? IS NOT NULL AND ? = '${OAUTH_GRANT_PREFIX}' || g.generation))`
  )
    .bind(
      clientId,
      userId,
      clientId,
      reference ?? null,
      reference ?? null,
      reference ?? null,
      reference ?? null,
      reference ?? null
    )
    .first();
  if (!row) invalidGrant();
}

/** Only inspect the provider's authenticated, verified result; never decode an unverified request token. */
export async function guardOAuthIntrospection(
  ctx: GenericEndpointContext & {
    context: GenericEndpointContext['context'] & { returned?: unknown };
  },
  env: CloudflareBindings
) {
  if (ctx.path !== '/oauth2/introspect') return;
  const result = ctx.context.returned as Record<string, unknown> | null;
  if (!result || result.active !== true || typeof result.azp !== 'string')
    return; // Refresh introspection has no azp; its live D1 row is already checked by the provider.
  try {
    const reference = result[OAUTH_GRANT_CLAIM];
    if (
      typeof result.sub !== 'string' ||
      (reference !== undefined && !validGrantReference(reference))
    )
      invalidGrant();
    await assertGrant(env, result.sub, result.azp, reference);
  } catch (error) {
    if (!(error instanceof APIError)) throw error;
    return ctx.json({ active: false });
  }
}

/** Provider extension points keep consent, code, refresh and JWT on one immutable authorization generation. */
export function oauthGrantOptions(
  env?: CloudflareBindings
): Pick<OAuthOptions<Scope[]>, 'postLogin' | 'extensions'> {
  if (!env) return {};
  return {
    postLogin: {
      page: '/settings/security',
      shouldRedirect: () => false,
      consentReferenceId: async ({ user, session }) => {
        const state = await getOAuthProviderState();
        const clientId = new URLSearchParams(state?.query).get('client_id');
        if (!user?.id || !session?.id || !clientId) invalidGrant();
        const live = await readSessionAuthentication(env, session.id);
        if (
          !live ||
          live.userId !== user.id ||
          live.banned ||
          live.expiresAt <= new Date() ||
          !isCurrentSession(live, { authVersion: live.userAuthVersion })
        )
          invalidGrant();
        return referenceFor(env, user.id, clientId);
      },
    },
    extensions: [
      {
        claims: {
          accessToken: async ({
            user,
            client,
            referenceId,
            grantType,
            sessionId,
          }) => {
            if (!user?.id) invalidGrant();
            if (grantType === 'authorization_code') {
              const live = sessionId
                ? await readSessionAuthentication(env, sessionId)
                : null;
              if (
                !live ||
                live.userId !== user.id ||
                live.banned ||
                live.expiresAt <= new Date() ||
                !isCurrentSession(live, { authVersion: live.userAuthVersion })
              )
                invalidGrant();
            }
            // Stored nullable SQLite fields reach refresh callbacks as null despite the SDK's optional-string type.
            const reference = referenceId ?? undefined;
            await assertGrant(env, user.id, client.clientId, reference);
            return reference ? { [OAUTH_GRANT_CLAIM]: reference } : {};
          },
          userInfo: async ({ user, client, jwt }) => {
            try {
              const reference = jwt[OAUTH_GRANT_CLAIM];
              if (
                !client?.clientId ||
                (reference !== undefined && !validGrantReference(reference))
              )
                invalidGrant();
              await assertGrant(env, user.id, client.clientId, reference);
            } catch (error) {
              if (!(error instanceof APIError)) throw error;
              throw new APIError('UNAUTHORIZED', {
                error: 'invalid_token',
                error_description: 'The application authorization was revoked.',
              });
            }
            return {};
          },
        },
      },
    ],
  };
}
