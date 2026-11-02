import { and, eq, gt, isNotNull, ne, or, sql } from 'drizzle-orm';
import { userEmails } from '../db/app.schema';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';

/** Active mailbox claims span primary addresses and verified/pending alternate addresses. */
export async function emailClaimedByOther(
  db: DrizzleDB,
  email: string,
  userId?: string
) {
  const normalized = email.trim().toLowerCase();
  const [primary, alternate] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(sql`lower(${users.email})`, normalized),
          userId ? ne(users.id, userId) : undefined
        )
      )
      .get(),
    db
      .select({ id: userEmails.id })
      .from(userEmails)
      .where(
        and(
          eq(userEmails.email, normalized),
          userId ? ne(userEmails.userId, userId) : undefined,
          or(
            isNotNull(userEmails.verifiedAt),
            gt(userEmails.verificationExpiresAt, new Date())
          )
        )
      )
      .get(),
  ]);
  return !!(primary || alternate);
}
