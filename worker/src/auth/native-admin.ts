// CloudForge fork addition (2026-11-04). SPDX-License-Identifier: GPL-3.0-or-later.
import type { GenericEndpointContext } from '@better-auth/core';
import { tryGetCurrentAuthEndpointContext } from '@better-auth/core/context';
import { APIError, getSessionFromCtx } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { DrizzleDB } from '../db/middleware';
import {
  accessWriteGuard,
  captureAccessWrite,
  type AccessWriteAuthorization,
} from '../access/write';
import { recentAuthorization } from './recent';

const paths = new Set([
  '/admin/set-role',
  '/admin/create-user',
  '/admin/update-user',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/remove-user',
  '/admin/set-user-password',
  '/admin/impersonate-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
]);
const authority = Symbol('cloudforge.native-admin-write');
type State = { [authority]?: AccessWriteAuthorization };
const denied = () =>
  new APIError('FORBIDDEN', {
    code: 'ADMIN_AUTHORIZATION_CHANGED',
    message: 'Administrative authorization changed. Refresh and try again.',
  });

/** Capture once before native endpoint target lookups; trusted bootstrap calls have no request. */
export async function captureNativeAdminWrite(
  ctx: GenericEndpointContext,
  db: DrizzleDB
) {
  if (!paths.has(ctx.path) || (!ctx.request && !ctx.headers)) return;
  const active = await getSessionFromCtx(ctx);
  if (!active) throw new APIError('UNAUTHORIZED');
  const recent = await recentAuthorization(
    db,
    active.session.id,
    active.user.id
  );
  const permit = await captureAccessWrite(db, recent ?? undefined, {
    kind: 'instance',
  });
  if (!permit) throw denied();
  (ctx.context as State)[authority] = permit;
}

function state() {
  const ctx = tryGetCurrentAuthEndpointContext();
  if (!ctx || !paths.has(ctx.path ?? '') || (!ctx.request && !ctx.headers))
    return;
  const value = ctx.context as State;
  if (!value[authority]) throw denied();
  return value;
}

/** Custom native endpoints share the same captured proof in their conditional DML. */
export function nativeAdminWriteGuard(ctx: GenericEndpointContext) {
  const permit = (ctx.context as State)[authority];
  if (!permit) throw denied();
  return accessWriteGuard(permit);
}

const dialect = new SQLiteSyncDialect();
const marker = 'CLOUDFORGE_NATIVE_ADMIN_AUTH_CHANGED';
export function isNativeAdminAuthorizationFailure(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 8; depth++) {
    if (current instanceof Error && current.message.includes(marker))
      return true;
    if (
      current instanceof APIError &&
      current.body?.code === 'ADMIN_AUTHORIZATION_CHANGED'
    )
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Only the SDK's Drizzle adapter uses this binding. Keep its SQL and all SDK hooks intact.
 * D1 batch is transactional: a deliberately invalid JSON path aborts the write when the
 * original proof is no longer valid. Reads and non-admin flows use the original binding.
 */
export function nativeAdminDatabase(db: D1Database): D1Database {
  const statements = new WeakMap<
    D1PreparedStatement,
    { original: D1PreparedStatement; write: boolean }
  >();
  const guardedBatch = async (input: D1PreparedStatement[]) => {
    const entries = input.map(
      (statement) =>
        statements.get(statement) ?? { original: statement, write: true }
    );
    const active = entries.some((entry) => entry.write) ? state() : undefined;
    if (!active) return db.batch(entries.map((entry) => entry.original));
    const permit = active[authority]!;
    const assertion = dialect.sqlToQuery(sql`SELECT json_extract('{}',
      CASE WHEN ${accessWriteGuard(permit)} THEN '$' ELSE ${marker} END)`);
    try {
      const result = await db.batch([
        db.prepare(assertion.sql).bind(...assertion.params),
        ...entries.map((entry) => entry.original),
        // A legitimate user/role write can advance ACL generation itself. Carry forward
        // only the generation observed inside this same successful transaction.
        db.prepare('SELECT generation FROM access_control_state WHERE id = 1'),
      ]);
      const generation = (
        result.at(-1)?.results[0] as { generation?: number } | undefined
      )?.generation;
      if (!Number.isSafeInteger(generation)) throw denied();
      active[authority] = { ...permit, generation: generation! };
      return result.slice(1, -1);
    } catch (error) {
      if (isNativeAdminAuthorizationFailure(error)) throw denied();
      throw error;
    }
  };
  const wrap = (
    original: D1PreparedStatement,
    write: boolean
  ): D1PreparedStatement => {
    const statement = new Proxy(original, {
      get(target, property) {
        if (property === 'bind')
          return (...args: unknown[]) => wrap(target.bind(...args), write);
        if (['all', 'run', 'first', 'raw'].includes(String(property))) {
          return async (...args: unknown[]) => {
            if (!write || !state()) {
              return Reflect.apply(Reflect.get(target, property), target, args);
            }
            // Drizzle's raw row mapper uses D1's returned column insertion order, as
            // its own batch implementation does. This adapter never requests headers.
            if (
              property === 'raw' &&
              (args[0] as { columnNames?: boolean })?.columnNames
            )
              throw new Error(
                'Native admin adapter does not support raw column headers'
              );
            const result = (await guardedBatch([statement]))[0];
            if (property === 'raw')
              return result.results.map((row) =>
                Object.values(row as Record<string, unknown>)
              );
            if (property === 'first') {
              const row = result.results[0] as
                Record<string, unknown> | undefined;
              return row
                ? typeof args[0] === 'string'
                  ? row[args[0]]
                  : row
                : null;
            }
            return result;
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    statements.set(statement, { original, write });
    return statement;
  };
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare')
        return (query: string) =>
          wrap(target.prepare(query), !/^\s*select\b/i.test(query));
      if (property === 'batch') return guardedBatch;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
