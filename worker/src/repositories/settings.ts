// CloudForge fork addition (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import { and, eq, sql } from 'drizzle-orm';
import {
  accessWriteGuard,
  type AccessWriteAuthorization,
} from '../access/write';
import { recordAudit } from '../audit/service';
import { repositories, type Repository } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import type { GitService } from '../git/service';
import { nameTaken } from './create';
import {
  invalidProtectedPatterns,
  normalizeProtectedPatterns,
} from './protected-branches';
import { isValidRepoName, normalizeRepoName, type Namespace } from './service';

export type RepositorySettingsInput = Partial<
  Pick<
    Repository,
    | 'name'
    | 'description'
    | 'defaultBranch'
    | 'visibility'
    | 'protectedBranches'
    | 'deleteMergedBranches'
    | 'hasIssues'
  >
>;

type SettingsResult =
  | { ok: true; repo: Repository }
  | { ok: false; status: 400 | 409; error: string };

export const repositorySettingsConflict = {
  ok: false as const,
  status: 409 as const,
  error: 'Repository settings or authorization changed. Refresh and try again.',
};

/** Compare editable values, not the seconds-resolution activity timestamp or unrelated counters. */
function settingsSnapshot(before: Repository, owner: string, name: string) {
  const namespace =
    before.teamId === null
      ? sql`EXISTS (SELECT 1 FROM users settings_owner
        WHERE settings_owner.id = ${before.ownerId} AND settings_owner.username = ${owner.toLowerCase()})`
      : sql`EXISTS (SELECT 1 FROM teams settings_team
        WHERE settings_team.id = ${before.teamId} AND settings_team.slug = ${owner.toLowerCase()})`;
  return and(
    eq(repositories.name, name),
    eq(repositories.name, before.name),
    eq(repositories.ownerId, before.ownerId),
    sql`${repositories.teamId} IS ${before.teamId}`,
    eq(repositories.artifactsName, before.artifactsName),
    eq(repositories.visibility, before.visibility),
    sql`${repositories.description} IS ${before.description}`,
    eq(repositories.defaultBranch, before.defaultBranch),
    sql`json(${repositories.protectedBranches}) IS json(${before.protectedBranches === null ? null : JSON.stringify(before.protectedBranches)})`,
    eq(repositories.deleteMergedBranches, before.deleteMergedBranches),
    eq(repositories.hasIssues, before.hasIssues),
    namespace
  );
}

/** Save with the original request proof. A zero-row receipt never becomes success or an automatic retry. */
export async function updateRepositorySettings(
  db: DrizzleDB,
  git: GitService,
  before: Repository,
  namespace: Namespace,
  address: { owner: string; repo: string },
  input: RepositorySettingsInput,
  authorization: AccessWriteAuthorization
): Promise<SettingsResult> {
  if (
    authorization.target.kind !== 'repository' ||
    authorization.target.repositoryId !== before.id
  )
    return repositorySettingsConflict;
  const patch: Partial<Repository> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = normalizeRepoName(input.name);
    if (!isValidRepoName(name))
      return { ok: false, status: 400, error: 'Repository name is invalid' };
    if (name !== before.name) {
      if (await nameTaken(db, before, name))
        return {
          ok: false,
          status: 409,
          error: 'Name already exists in this namespace',
        };
      patch.name = name;
    }
  }
  if (input.description !== undefined)
    patch.description = input.description?.trim() || null;
  if (
    input.visibility !== undefined &&
    input.visibility !== before.visibility
  ) {
    if (before.teamId && input.visibility === 'private')
      return {
        ok: false,
        status: 400,
        error: 'Team repositories are always visible to every member',
      };
    patch.visibility = input.visibility;
  }
  // A same-value submission is also sent by the settings form for an empty repository.
  if (
    input.defaultBranch !== undefined &&
    input.defaultBranch !== before.defaultBranch
  ) {
    if (!(await git.refs()).has(`refs/heads/${input.defaultBranch}`))
      return { ok: false, status: 400, error: 'Branch not found' };
    patch.defaultBranch = input.defaultBranch;
  }
  if (input.protectedBranches !== undefined) {
    const patterns = (input.protectedBranches ?? []).map((p) => p.trim());
    const invalid = invalidProtectedPatterns(patterns);
    if (invalid) return { ok: false, status: 400, error: invalid };
    patch.protectedBranches = normalizeProtectedPatterns(patterns);
  }
  if (input.deleteMergedBranches !== undefined)
    patch.deleteMergedBranches = input.deleteMergedBranches;
  if (input.hasIssues !== undefined) patch.hasIssues = input.hasIssues;
  const available =
    patch.name === undefined
      ? sql`1`
      : sql`NOT EXISTS (
    SELECT 1 FROM repositories occupied WHERE occupied.id != ${before.id} AND occupied.name = ${patch.name}
      AND ${
        before.teamId === null
          ? sql`occupied.team_id IS NULL AND occupied.owner_id = ${before.ownerId}`
          : sql`occupied.team_id = ${before.teamId}`
      })`;
  const written = await db
    .update(repositories)
    .set(patch)
    .where(
      and(
        eq(repositories.id, before.id),
        accessWriteGuard(authorization),
        settingsSnapshot(before, address.owner, address.repo),
        available
      )
    )
    .returning()
    .get();
  if (!written) return repositorySettingsConflict;
  // Name/visibility updates may themselves advance ACL generation. The receipt is authoritative.
  await auditRepoChanges(db, authorization.userId, before, patch, namespace);
  return { ok: true, repo: written };
}

async function auditRepoChanges(
  db: DrizzleDB,
  actorId: string,
  before: Repository,
  patch: Partial<Repository>,
  ns: Namespace
) {
  const target = `${ns.username}/${patch.name ?? before.name}`;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of [
    'name',
    'description',
    'defaultBranch',
    'protectedBranches',
    'deleteMergedBranches',
    'hasIssues',
  ] as const) {
    if (!(key in patch)) continue;
    const list = key === 'protectedBranches';
    const from = list ? (before[key] ?? []) : before[key];
    const to = list ? (patch[key] ?? []) : patch[key];
    if (JSON.stringify(from) !== JSON.stringify(to))
      changes[key] = { from, to };
  }
  if (Object.keys(changes).length)
    await recordAudit(db, {
      repositoryId: before.id,
      actorId,
      action: 'settings.changed',
      target,
      data: { changes },
    });
  if (patch.visibility !== undefined && patch.visibility !== before.visibility)
    await recordAudit(db, {
      repositoryId: before.id,
      actorId,
      action: 'visibility.changed',
      target,
      data: { from: before.visibility, to: patch.visibility },
    });
}
