// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { admin } from 'better-auth/plugins';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { and, eq, sql } from 'drizzle-orm';
import { users } from '../db/auth.schema';
import type { DrizzleDB } from '../db/middleware';
import { isAgentUser } from '../agents/identity';
import { recordAudit } from '../audit/service';
import { nativeAdminWriteGuard } from './native-admin';

/** Keep the SDK's session middleware and contract, but delete the account in one D1 statement. */
export function repositorySafeAdmin(
  env: CloudflareBindings | undefined,
  db: DrizzleDB
) {
  const plugin = admin();
  const original = plugin.endpoints.removeUser;
  return {
    ...plugin,
    endpoints: {
      ...plugin.endpoints,
      removeUser: createAuthEndpoint(
        original.path,
        original.options,
        async (ctx) => {
          const active = ctx.context.session;
          if (active.user.role !== 'admin')
            throw APIError.from(
              'FORBIDDEN',
              plugin.$ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS
            );
          if (ctx.body.userId === active.user.id)
            throw APIError.from(
              'BAD_REQUEST',
              plugin.$ERROR_CODES.YOU_CANNOT_REMOVE_YOURSELF
            );
          if (!env) throw new APIError('SERVICE_UNAVAILABLE');
          const target = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, ctx.body.userId))
            .get();
          if (!target)
            throw new APIError('NOT_FOUND', {
              code: 'USER_NOT_FOUND',
              message: 'User not found.',
            });
          if (await isAgentUser(db, target.id))
            throw new APIError('FORBIDDEN', {
              message: 'Delete agents from Site admin → Agents.',
            });
          if (
            await env.DB.prepare(
              'SELECT 1 FROM repositories WHERE owner_id=? LIMIT 1'
            )
              .bind(target.id)
              .first()
          )
            throw new APIError('FORBIDDEN', {
              code: 'USER_OWNS_REPOSITORIES',
              message:
                'Delete this member’s repositories through their normal deletion flow first.',
            });
          // The SDK normally removes credentials before its user.delete.before hook. A final
          // owned-repository check must instead guard the user DELETE and all its cascades together.
          const deleted = await db
            .delete(users)
            .where(
              and(
                eq(users.id, target.id),
                sql`NOT EXISTS (SELECT 1 FROM repositories r WHERE r.owner_id=${target.id})`,
                sql`NOT EXISTS (SELECT 1 FROM agents a WHERE a.user_id=${target.id})`,
                nativeAdminWriteGuard(ctx)
              )
            )
            .returning({ id: users.id })
            .get();
          if (!deleted)
            throw new APIError('CONFLICT', {
              code: 'USER_DELETION_CHANGED',
              message:
                'The member or authorization changed. Refresh and try again.',
            });
          await recordAudit(db, {
            repositoryId: null,
            actorId: active.user.id,
            action: 'user.deleted',
            target: target.id,
            data: {},
          });
          return ctx.json({ success: true });
        }
      ),
    },
  };
}
