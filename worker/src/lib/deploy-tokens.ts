import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import {
  agents,
  repositories,
  repositoryDeployTokens,
  type Repository,
  type RepositoryDeployToken,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import { hashToken, randomToken } from './tokens';

export const MAX_DEPLOY_TOKENS_PER_REPO = 50;

/** The admin part of permissionsFor, read at the mutation rather than from the request's earlier snapshot. */
export const deployTokenAdmin = (repositoryId: string, userId: string) => sql`
  EXISTS (SELECT 1 FROM users issuer
    INNER JOIN repositories target ON target.id = ${repositoryId}
    WHERE issuer.id = ${userId} AND coalesce(issuer.banned, 0) = 0
      AND (issuer.role = 'admin' OR target.owner_id = issuer.id)
      AND NOT EXISTS (SELECT 1 FROM agents WHERE agents.user_id = issuer.id))`;

export async function canManageDeployTokens(
  db: DrizzleDB,
  repositoryId: string,
  userId: string
): Promise<boolean> {
  const row = await db.get<{ allowed: number }>(
    sql`SELECT ${deployTokenAdmin(repositoryId, userId)} AS allowed`
  );
  return row?.allowed === 1;
}

/** Null if the quota or current authorization changed; the plaintext is returned only after a successful insert. */
export async function createDeployToken(
  db: DrizzleDB,
  repositoryId: string,
  createdById: string,
  input: { name: string; scope: 'read' | 'write'; expiresInDays: number }
): Promise<{ token: RepositoryDeployToken; plaintext: string } | null> {
  const plaintext = randomToken('cfd_', 32);
  const tokenHash = await hashToken(plaintext);
  const now = new Date();
  const token: RepositoryDeployToken = {
    id: crypto.randomUUID(),
    repositoryId,
    createdById,
    name: input.name,
    scope: input.scope,
    tokenHash,
    lastUsedAt: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
  };
  // Count and insert share one statement; simultaneous requests cannot each consume the last slot.
  const inserted = await db.get<{ id: string }>(sql`
    INSERT INTO repository_deploy_tokens
      (id, repository_id, created_by_id, name, token_hash, scope, last_used_at, created_at, expires_at)
    SELECT ${token.id}, ${repositoryId}, ${createdById}, ${token.name}, ${tokenHash}, ${token.scope}, NULL,
      ${now.getTime()}, ${token.expiresAt.getTime()}
    WHERE ${deployTokenAdmin(repositoryId, createdById)}
      AND (SELECT count(*) FROM repository_deploy_tokens WHERE repository_id = ${repositoryId}) < ${MAX_DEPLOY_TOKENS_PER_REPO}
    RETURNING id
  `);
  return inserted ? { token, plaintext } : null;
}

/** A repository-bound credential, never a personal session or an inherited administrator identity. */
export async function authenticateDeployToken(
  db: DrizzleDB,
  repository: Repository,
  plaintext: string
): Promise<RepositoryDeployToken | null> {
  if (!/^cfd_[0-9a-f]{64}$/.test(plaintext)) return null;
  const tokenHash = await hashToken(plaintext);
  const row = await db
    .select({ token: repositoryDeployTokens })
    .from(repositoryDeployTokens)
    .innerJoin(users, eq(users.id, repositoryDeployTokens.createdById))
    .innerJoin(
      repositories,
      eq(repositories.id, repositoryDeployTokens.repositoryId)
    )
    .leftJoin(agents, eq(agents.userId, users.id))
    .where(
      and(
        eq(repositoryDeployTokens.repositoryId, repository.id),
        eq(repositoryDeployTokens.tokenHash, tokenHash),
        gt(repositoryDeployTokens.expiresAt, new Date()),
        or(isNull(users.banned), eq(users.banned, false)),
        isNull(agents.userId),
        or(eq(users.role, 'admin'), eq(repositories.ownerId, users.id))
      )
    )
    .get();
  return row?.token ?? null;
}
