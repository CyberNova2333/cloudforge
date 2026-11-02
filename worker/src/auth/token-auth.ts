// Personal access tokens on the REST API (docs/webhooks.md): only for the commit status endpoints, which CI servers call
// without a browser session. `Authorization: Bearer <token>` (or `token <token>`); a read-only token reads only.
import { eq } from 'drizzle-orm';
import { agents, personalAccessTokens } from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import { hashToken } from './tokens';
import type { SessionUser } from '../variables';

/** The API paths that take a token: posting and reading commit statuses. */
const TOKEN_PATHS =
  /^\/api\/repos\/[^/]+\/[^/]+\/(?:statuses\/[0-9a-fA-F]{40}|commits\/[^/]+\/status(?:es)?)$/;

export const acceptsToken = (path: string) => TOKEN_PATHS.test(path);

function bearer(header: string | null): string | null {
  const m = header?.match(/^(?:Bearer|token)\s+(\S+)$/i);
  return m ? m[1] : null;
}

/**
 * The member a request's token belongs to, with its scope; null without a token, or for an unknown, expired, banned
 * or agent's one. Records when the token was last used through `after`.
 */
export async function tokenUser(
  db: DrizzleDB,
  headers: Headers,
  after: (work: Promise<unknown>) => void
): Promise<{ user: SessionUser; scope: 'read' | 'write' } | null> {
  const token = bearer(headers.get('Authorization'));
  if (!token) return null;
  const row = await db
    .select({ pat: personalAccessTokens, user: users, agent: agents.userId })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .leftJoin(agents, eq(agents.userId, users.id))
    .where(eq(personalAccessTokens.tokenHash, await hashToken(token)))
    .get();
  if (
    !row ||
    row.agent ||
    row.user.banned ||
    (row.pat.expiresAt && row.pat.expiresAt < new Date())
  )
    return null;
  after(
    db
      .update(personalAccessTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(personalAccessTokens.id, row.pat.id))
      .run()
  );
  const u = row.user;
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      username: u.username,
      role: u.role,
      image: u.image,
      banned: u.banned,
    },
    scope: row.pat.scope,
  };
}
