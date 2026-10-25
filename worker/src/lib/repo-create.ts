// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { and, eq, sql } from 'drizzle-orm';
import { repositories, type Repository } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import {
  isValidRepoName,
  getTeam,
  gitFor,
  normalizeRepoName,
  teamNamespace,
  userNamespace,
  type Namespace,
} from './repos';

/** Repo names are unique per namespace (user or team). */
export async function nameTaken(
  db: DrizzleDB,
  repo: { ownerId: string; teamId: string | null },
  name: string
) {
  const scope = repo.teamId
    ? eq(repositories.teamId, repo.teamId)
    : and(
        eq(repositories.ownerId, repo.ownerId),
        sql`${repositories.teamId} IS NULL`
      );
  return !!(await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(scope, eq(repositories.name, name)))
    .get());
}

export interface CreateRepositoryInput {
  name: string;
  description?: string;
  addReadme?: boolean;
  /** Personal repos default to private; team repos are internal unless public. */
  owner?: 'user' | 'team';
  visibility?: 'private' | 'internal' | 'public';
}

export type CreateRepositoryResult =
  | { ok: true; repo: Repository; namespace: Namespace }
  | { ok: false; status: 400 | 409; error: string };

/** Creates the Artifacts repo, then the D1 row (rolling storage back on failure), then a README. */
export async function createRepository(
  env: CloudflareBindings,
  db: DrizzleDB,
  user: {
    id: string;
    name: string;
    email: string;
    username?: string | null;
    image?: string | null;
  },
  input: CreateRepositoryInput
): Promise<CreateRepositoryResult> {
  const name = normalizeRepoName(input.name);
  if (!isValidRepoName(name)) {
    return { ok: false, status: 400, error: 'Repository name is invalid' };
  }
  const owner = input.owner ?? 'user';
  const team = owner === 'team' ? await getTeam(db) : null;
  if (owner === 'team' && !team)
    return {
      ok: false,
      status: 400,
      error: 'There is no team yet. A site admin can create one in Site admin.',
    };
  if (await nameTaken(db, { ownerId: user.id, teamId: team?.id ?? null }, name))
    return {
      ok: false,
      status: 409,
      error: `${team ? team.name : 'You'} already ${team ? 'has' : 'have'} a repository named ${name}`,
    };
  const ns = team ? teamNamespace(team) : userNamespace(user);

  const id = crypto.randomUUID();
  const now = new Date();
  const row: Repository = {
    id,
    ownerId: user.id,
    teamId: team?.id ?? null,
    visibility: team
      ? input.visibility === 'public'
        ? 'public'
        : 'internal'
      : (input.visibility ?? 'private'),
    name,
    description: input.description?.trim() || null,
    defaultBranch: 'main',
    protectedBranches: null,
    artifactsName: `r_${id}`,
    nextPrNumber: 1,
    hasIssues: true,
    mergingPausedAt: null,
    mergingPausedById: null,
    deleteMergedBranches: true,
    language: null,
    languageSha: null,
    createdAt: now,
    updatedAt: now,
  };
  await env.ARTIFACTS.create(row.artifactsName, {
    setDefaultBranch: 'main',
    description: `${ns.username}/${name}`,
  });
  try {
    await db.insert(repositories).values(row);
  } catch (e) {
    await env.ARTIFACTS.delete(row.artifactsName);
    throw e;
  }
  if (input.addReadme) {
    const readme = `# ${name}\n${row.description ? `\n${row.description}\n` : ''}`;
    await gitFor(env, row).initialCommit(
      'main',
      { 'README.md': readme },
      {
        name: user.name,
        email: user.email,
        timestamp: Math.floor(Date.now() / 1000),
      },
      'Initial commit'
    );
  }
  return { ok: true, repo: row, namespace: ns };
}
