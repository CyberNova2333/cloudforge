// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { eq } from 'drizzle-orm';
import { namespaceClaims } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import { isReservedUsername, USERNAME_RE } from './usernames';

/** Usernames and the team slug share the URL namespace; compared case-insensitively. */
export async function namespaceTaken(
  db: DrizzleDB,
  name: string,
  except?: { teamId?: string; userId?: string }
) {
  const n = name.toLowerCase();
  const claim = await db
    .select({
      kind: namespaceClaims.kind,
      subjectId: namespaceClaims.subjectId,
    })
    .from(namespaceClaims)
    .where(eq(namespaceClaims.slug, n))
    .get();
  if (!claim) return false;
  return claim.kind === 'team'
    ? claim.subjectId !== except?.teamId
    : claim.subjectId !== except?.userId;
}

// These are stable RAISE messages from the managed access triggers. Match driver errors,
// not arbitrary text inside Drizzle's SQL/parameter wrapper or a user's display name.
export const NAMESPACE_CONFLICT = 'CloudForge namespace conflict';
export const LEGACY_TEAM_CONFLICT = 'CloudForge legacy team conflict';

function isAccessConflict(error: unknown, reason: string): boolean {
  let current = error;
  for (let depth = 0; current && depth < 8; depth++) {
    const message =
      typeof current === 'string'
        ? current
        : (current as { message?: unknown }).message;
    if (typeof message === 'string') {
      const text = message.replace(/^D1_ERROR:\s*/, '');
      if (
        text === reason ||
        (text.startsWith(`${reason}: `) &&
          /^SQLITE_CONSTRAINT(?:_[A-Z]+)?(?: \(extended: SQLITE_CONSTRAINT(?:_[A-Z]+)?\))?$/.test(
            text.slice(reason.length + 2)
          ))
      )
        return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export const isNamespaceConflict = (error: unknown) =>
  isAccessConflict(error, NAMESPACE_CONFLICT);

export const isLegacyTeamConflict = (error: unknown) =>
  isAccessConflict(error, LEGACY_TEAM_CONFLICT);

export function isValidSlug(slug: string) {
  return USERNAME_RE.test(slug) && !isReservedUsername(slug);
}
