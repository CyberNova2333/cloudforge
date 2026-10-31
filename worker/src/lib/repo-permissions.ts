// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { Repository } from '../db/app.schema';
import type { SessionUser } from '../variables';

/** The existing public DTO. Named capabilities do not add assignable roles. */
export interface RepoPermissions {
  read: boolean;
  write: boolean;
  admin: boolean;
}

const capabilityPermission = {
  read: 'read',
  push: 'write',
  manageIssues: 'write',
  editPullMetadata: 'write',
  managePulls: 'write',
  runActions: 'write',
  publishStatus: 'write',
  publishRelease: 'write',
  editSettings: 'admin',
  manageProtection: 'admin',
  manageAccess: 'admin',
  manageAgents: 'admin',
  manageWebhooks: 'admin',
  manageActionsSecrets: 'admin',
  manageActionsVariables: 'admin',
  manageDeployTokens: 'admin',
  deleteRepository: 'admin',
  deleteIssues: 'admin',
} as const satisfies Record<string, keyof RepoPermissions>;

export type RepoCapability = keyof typeof capabilityPermission;

/** Preserve the current permission boundary while callers name the operation they require. */
export function can(
  perms: RepoPermissions,
  capability: RepoCapability
): boolean {
  return perms[capabilityPermission[capability]];
}

/** A member credential's read scope caps every named mutation, including administrator operations. */
export function withTokenScope(
  perms: RepoPermissions,
  scope: string | null | undefined
): RepoPermissions {
  return scope === 'read' ? { ...perms, write: false, admin: false } : perms;
}

type RepositoryAccess = Pick<Repository, 'ownerId' | 'teamId' | 'visibility'>;
type MemberAccess = Pick<SessionUser, 'id' | 'role' | 'banned'>;

export const isPublic = (repo: Pick<Repository, 'visibility'>) =>
  repo.visibility === 'public';

/** A team namespace keeps instance-wide member visibility, including legacy private-valued rows. */
export const readableByMembers = (
  repo: Pick<Repository, 'teamId' | 'visibility'>
) =>
  repo.teamId !== null ||
  repo.visibility === 'internal' ||
  repo.visibility === 'public';

/** Whether access depends on looking up a collaboration row. */
export function needsCollaboration(
  repo: Pick<Repository, 'ownerId'>,
  user: MemberAccess
) {
  return user.role !== 'admin' && repo.ownerId !== user.id;
}

/** Shared compatibility rule for single, batch and notification candidate evaluation. */
export function permissionsOf(
  repo: RepositoryAccess,
  user: MemberAccess | undefined,
  collaborator: boolean
): RepoPermissions {
  if (!user || user.banned)
    return { read: isPublic(repo), write: false, admin: false };
  if (!needsCollaboration(repo, user))
    return { read: true, write: true, admin: true };
  if (collaborator) return { read: true, write: true, admin: false };
  return { read: readableByMembers(repo), write: false, admin: false };
}
