// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { auditEvents, namespaceClaims, teams } from '../db/app.schema';
import { schema } from '../db/schema';
import * as namespaces from '../lib/namespaces';
import { bootstrapAdmin, call, makeEnv, type TestEnv } from './helpers/app';

afterEach(() => vi.restoreAllMocks());
const putTeam = (t: TestEnv, cookie: string, slug: string) =>
  call(t, '/api/team', { cookie, method: 'PUT', json: { slug, name: slug } });

function barrier(slug: string) {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = namespaces.namespaceTaken;
  vi.spyOn(namespaces, 'namespaceTaken').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1] === slug) {
      enter();
      await released;
    }
    return result;
  });
  return { entered, release };
}

// All mutations below run against real workerd D1 after the real authorization
// and namespace reads. Only the scheduling barrier is replaced.
const invalidations = [
  [
    'administrator demoted',
    sql`UPDATE users SET role='user' WHERE username='octocat'`,
  ],
  [
    'administrator banned',
    sql`UPDATE users SET banned=1 WHERE username='octocat'`,
  ],
  ['session deleted', sql`DELETE FROM sessions`],
  ['session expired', sql`UPDATE sessions SET expires_at=0`],
  [
    'credential generation changed',
    sql`UPDATE accounts SET password=password || '-rotated' WHERE provider_id='credential'`,
  ],
  [
    'credential removed',
    sql`DELETE FROM accounts WHERE provider_id='credential'`,
  ],
  [
    'authentication policy changed',
    sql`INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,0)
      ON CONFLICT(id) DO UPDATE SET version=version+1`,
  ],
  ['password proof expired', sql`UPDATE sessions SET auth_time=1`],
  ['password proof replaced', sql`UPDATE sessions SET auth_time=auth_time-1`],
  [
    'ACL generation changed',
    sql`UPDATE users SET username='renamed-admin' WHERE username='octocat'`,
  ],
] as const;

describe('team writes recheck authority in the mutation', () => {
  for (const existing of [false, true]) {
    it.each(invalidations)(
      `${existing ? 'rename' : 'create'} rejects %s after pre-read`,
      async (_name, invalidate) => {
        const t = makeEnv();
        const admin = await bootstrapAdmin(t);
        const db = drizzle(t.env.DB, { schema });
        if (existing)
          expect((await putTeam(t, admin, 'initial')).status).toBe(200);
        const before = await db.select().from(teams).all();
        const claims = await db
          .select()
          .from(namespaceClaims)
          .where(eq(namespaceClaims.kind, 'team'))
          .all();
        const audits = await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.target, 'team'))
          .all();
        const hold = barrier('requested');
        const pending = putTeam(t, admin, 'requested');
        try {
          await Promise.race([
            hold.entered,
            pending.then((response) => {
              throw new Error(`Ended before barrier: ${response.status}`);
            }),
          ]);
          await db.run(invalidate);
          hold.release();
          const response = await pending;
          expect(response.status).toBe(409);
          expect(response.headers.get('Cache-Control')).toBe('no-store');
          const body = await response.text();
          expect(body).not.toMatch(
            /RECENT_AUTHENTICATION_REQUIRED|SQLITE|auth_version|password/
          );
          expect(await db.select().from(teams).all()).toEqual(before);
          expect(
            await db
              .select()
              .from(namespaceClaims)
              .where(eq(namespaceClaims.kind, 'team'))
              .all()
          ).toEqual(claims);
          expect(
            await db
              .select()
              .from(auditEvents)
              .where(eq(auditEvents.target, 'team'))
              .all()
          ).toEqual(audits);
        } finally {
          hold.release();
          await Promise.allSettled([pending]);
        }
      }
    );
  }

  it('records only successful team changes and preserves the existing DTO', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const db = drizzle(t.env.DB, { schema });
    const create = await putTeam(t, admin, 'initial');
    expect(create.status).toBe(200);
    const { team } = (await create.json()) as { team: { id: string } };
    expect(Object.keys(team).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'slug',
    ]);
    expect((await putTeam(t, admin, 'renamed')).status).toBe(200);
    expect((await putTeam(t, admin, 'renamed')).status).toBe(200);
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.target, 'team'))
      .all();
    expect(rows.map((row) => row.action)).toEqual([
      'instance.settings',
      'instance.settings',
    ]);
    expect(rows.map((row) => row.data)).toEqual([
      {
        teamId: team.id,
        operation: 'created',
        name: 'initial',
        slug: 'initial',
      },
      {
        teamId: team.id,
        operation: 'updated',
        name: 'renamed',
        slug: 'renamed',
      },
    ]);
  });
});
