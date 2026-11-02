// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import { recentAuthorization } from '../../auth/recent';
import {
  accessWriteGuard,
  captureAccessWrite,
  type AccessWriteAuthorization,
  type AccessWriteTarget,
} from '../../access/write';
import { bootstrapAdmin, call, makeEnv } from '../helpers/app';

afterEach(() => vi.restoreAllMocks());
const instance = { kind: 'instance' } as const;
const clock = sql`CAST(unixepoch('subsecond') * 1000 AS INTEGER)`;

async function fixture() {
  const t = makeEnv();
  const cookie = await bootstrapAdmin(t);
  const identity = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { session: { id: string }; user: { id: string } };
  const db = drizzle(t.env.DB, { schema });
  const permit = (await recentAuthorization(
    db,
    identity.session.id,
    identity.user.id
  ))!;
  expect(permit).not.toBeNull();
  await db.run(sql`INSERT INTO instance_settings(key,value,updated_at)
    VALUES('access.write.probe','before',0)`);
  return {
    t,
    db,
    permit,
    userId: identity.user.id,
    sessionId: identity.session.id,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function capture(f: Fixture, target: AccessWriteTarget = instance) {
  const value = await captureAccessWrite(f.db, f.permit, target);
  expect(value).not.toBeNull();
  return value!;
}

// A real conditional UPDATE proves the predicate protects a write. Probe rows do
// not themselves advance ACL generation, so failures cannot be attributed to it.
async function write(
  f: Fixture,
  authority: AccessWriteAuthorization,
  allowed: boolean
) {
  const receipt = await f.db.get<{ value: string }>(sql`
    UPDATE instance_settings SET value='after'
    WHERE key='access.write.probe' AND ${accessWriteGuard(authority)} RETURNING value`);
  expect(receipt ?? null).toEqual(allowed ? { value: 'after' } : null);
  expect(
    await f.db.get(
      sql`SELECT value FROM instance_settings WHERE key='access.write.probe'`
    )
  ).toEqual({ value: allowed ? 'after' : 'before' });
}

// This fixture tests SQL authority at the write point, not factor cryptography or
// issuance. Existing two-factor tests cover those real enrollment/login flows.
async function withFactor(f: Fixture) {
  await f.db
    .run(sql`INSERT INTO two_factors(id,user_id,secret,backup_codes,verified)
    VALUES('factor',${f.userId},'fixture-secret','[]',1)`);
  await f.db.run(
    sql`UPDATE users SET two_factor_enabled=1 WHERE id=${f.userId}`
  );
  await f.db.run(sql`UPDATE sessions SET
    auth_version=(SELECT auth_version FROM users WHERE id=${f.userId}),
    auth_time=${clock}-1000,second_factor_method='totp',second_factor_time=${clock}-1000
    WHERE id=${f.sessionId}`);
  f.permit = (await recentAuthorization(f.db, f.sessionId, f.userId))!;
}

describe('access mutation authority snapshot (real D1)', () => {
  it('accepts a live administrator and rejects absent, foreign or stale permits', async () => {
    const f = await fixture();
    for (const permit of [
      undefined,
      { ...f.permit, sessionId: 'missing' },
      { ...f.permit, userId: 'someone-else' },
      { ...f.permit, authVersion: f.permit.authVersion + 1 },
    ])
      expect(await captureAccessWrite(f.db, permit, instance)).toBeNull();
    await write(f, await capture(f), true);
  });

  it('allows an ordinary repository owner, denies nonowner and does not grant instance administration', async () => {
    const f = await fixture();
    await f.db
      .run(sql`INSERT INTO repositories(id,owner_id,name,artifacts_name,created_at,updated_at)
      VALUES('owned',${f.userId},'owned','r_owned',0,0)`);
    await f.db.run(sql`UPDATE users SET role='user' WHERE id=${f.userId}`);
    expect(await captureAccessWrite(f.db, f.permit, instance)).toBeNull();
    await write(
      f,
      await capture(f, { kind: 'repository', repositoryId: 'owned' }),
      true
    );
    await f.db.run(
      sql`INSERT INTO users(id,name,email,username) VALUES('another','Another','another@example.com','another')`
    );
    await f.db.run(
      sql`UPDATE repositories SET owner_id='another' WHERE id='owned'`
    );
    expect(
      await captureAccessWrite(f.db, f.permit, {
        kind: 'repository',
        repositoryId: 'owned',
      })
    ).toBeNull();
    expect(
      await captureAccessWrite(f.db, f.permit, {
        kind: 'repository',
        repositoryId: 'missing',
      })
    ).toBeNull();
  });

  it.each([
    ['removed', sql`DELETE FROM accounts WHERE provider_id='credential'`],
    [
      'replaced',
      sql`UPDATE accounts SET id=id || '-replacement' WHERE provider_id='credential'`,
    ],
  ])(
    'rejects a credential account %s without a generation change',
    async (_, change) => {
      const f = await fixture();
      const authority = await capture(f);
      await f.db.run(change);
      expect(
        await f.db.get(
          sql`SELECT auth_version AS version FROM users WHERE id=${f.userId}`
        )
      ).toEqual({ version: authority.authVersion });
      await write(f, authority, false);
    }
  );

  it.each([
    ['factor deleted', sql`DELETE FROM two_factors`],
    ['factor replaced', sql`UPDATE two_factors SET id='replacement'`],
    ['factor no longer verified', sql`UPDATE two_factors SET verified=0`],
    [
      'recovery generation changed',
      sql`UPDATE two_factors SET recovery_version=recovery_version+1`,
    ],
    [
      'second proof replaced',
      sql`UPDATE sessions SET second_factor_time=second_factor_time-1`,
    ],
    [
      'second proof method replaced',
      sql`UPDATE sessions SET second_factor_method='recovery_code'`,
    ],
    ['password proof replaced', sql`UPDATE sessions SET auth_time=auth_time-1`],
  ])(
    'rejects %s even while both proof times remain fresh',
    async (_, change) => {
      const f = await fixture();
      await withFactor(f);
      const authority = await capture(f);
      await f.db.run(change);
      await write(f, authority, false);
    }
  );

  it('accepts enrolled recovery-code proof and rejects enabled MFA without a verified factor row', async () => {
    const f = await fixture();
    await withFactor(f);
    await f.db.run(
      sql`UPDATE sessions SET second_factor_method='recovery_code' WHERE id=${f.sessionId}`
    );
    await write(f, await capture(f), true);
    await f.db.run(sql`UPDATE two_factors SET verified=0`);
    expect(await captureAccessWrite(f.db, f.permit, instance)).toBeNull();
  });

  it('requires enrollment under enforced MFA even when the session already has the current policy version', async () => {
    const f = await fixture();
    await f.db
      .run(sql`INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,1)
      ON CONFLICT(id) DO UPDATE SET version=1,require_mfa=1`);
    await f.db.run(
      sql`UPDATE sessions SET policy_version=1 WHERE id=${f.sessionId}`
    );
    expect(await captureAccessWrite(f.db, f.permit, instance)).toBeNull();
    await withFactor(f);
    await write(f, await capture(f), true);
  });

  it('does not attach a new policy generation to an already captured mutation', async () => {
    const f = await fixture();
    const authority = await capture(f);
    await f.db
      .run(sql`INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,0)
      ON CONFLICT(id) DO UPDATE SET version=1,require_mfa=0`);
    await f.db.run(
      sql`UPDATE sessions SET policy_version=1 WHERE id=${f.sessionId}`
    );
    await write(f, authority, false);
    expect(await captureAccessWrite(f.db, f.permit, instance)).not.toBeNull();
  });

  it('rejects expired evidence using database time even if the Worker clock is stale', async () => {
    const f = await fixture();
    await f.db.run(
      sql`UPDATE sessions SET auth_time=${clock}-360000 WHERE id=${f.sessionId}`
    );
    const old = (await f.db.get<{ time: number }>(
      sql`SELECT auth_time AS time FROM sessions WHERE id=${f.sessionId}`
    ))!;
    vi.spyOn(Date, 'now').mockReturnValue(old.time + 1);
    // The existing pre-read accepts this frozen-clock proof; the write authority must not.
    const oldPermit = (await recentAuthorization(f.db, f.sessionId, f.userId))!;
    expect(oldPermit).not.toBeNull();
    expect(await captureAccessWrite(f.db, oldPermit, instance)).toBeNull();
  });

  it('checks database time again in the final mutation instead of reusing capture time', async () => {
    const f = await fixture();
    const authority = await capture(f);
    vi.spyOn(Date, 'now').mockReturnValue(authority.authTime);
    await f.db.run(
      sql`UPDATE sessions SET expires_at=${clock}-1 WHERE id=${f.sessionId}`
    );
    expect(
      await recentAuthorization(f.db, f.sessionId, f.userId)
    ).not.toBeNull();
    await write(f, authority, false);
  });

  it.each(['enabled=0', 'login_enabled=0', 'generation=generation+1'])(
    'rejects OIDC source revocation (%s) after local password verification',
    async (change) => {
      const f = await fixture();
      await f.t.env.DB.batch([
        f.t.env.DB.prepare(
          "INSERT INTO oidc_providers(id,issuer,version,digest,created_at) VALUES('source','https://identity.example',1,'digest',0)"
        ),
        f.t.env.DB.prepare(
          "INSERT INTO oidc_configuration(id,enabled,login_enabled,provider_id,version,digest,generation,action_id,updated_at) VALUES(1,1,1,'source',1,'digest',1,'fixture',0)"
        ),
        f.t.env.DB.prepare(
          "INSERT INTO oidc_bindings(id,provider_id,issuer,subject,user_id,active,revision,created_at,updated_at) VALUES('binding','source','https://identity.example','subject',?,1,1,0,0)"
        ).bind(f.userId),
        f.t.env.DB.prepare(
          "UPDATE sessions SET oidc_binding_id='binding',oidc_binding_revision=1,oidc_configuration_generation=1 WHERE id=?"
        ).bind(f.sessionId),
      ]);
      const authority = await capture(f);
      await f.db.run(
        sql.raw(`UPDATE oidc_configuration SET ${change} WHERE id=1`)
      );
      await write(f, authority, false);
      expect(await captureAccessWrite(f.db, f.permit, instance)).toBeNull();
    }
  );
});
