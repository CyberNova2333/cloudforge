// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/middleware';
import { users } from '../db/auth.schema';
import { inJsonArray } from '../shared/sql-set';
import type { SessionUser } from '../variables';

export type PublicUser = {
  id: string;
  username: string;
  name: string;
  image: string | null;
};

/** Account email is private member data, distinct from an address already present in a Git commit. */
export function accountEmailFor(
  subject: { id: string; email: string },
  viewer: Pick<SessionUser, 'id' | 'role' | 'banned'> | undefined
): string | null {
  return viewer &&
    !viewer.banned &&
    (viewer.role === 'admin' || viewer.id === subject.id)
    ? subject.email
    : null;
}

export function toPublicUser(u: {
  id: string;
  username?: string | null;
  name: string;
  image?: string | null;
}): PublicUser {
  return {
    id: u.id,
    username: u.username ?? u.id,
    name: u.name,
    image: u.image ?? null,
  };
}

export async function usersById(
  db: DrizzleDB,
  ids: string[]
): Promise<Map<string, PublicUser>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db
    .select()
    .from(users)
    .where(inJsonArray(users.id, unique))
    .all();
  return new Map(rows.map((u) => [u.id, toPublicUser(u)]));
}

export async function userByUsername(db: DrizzleDB, username: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .get();
}
