// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { env } from 'cloudflare:test';
import { ACCESS_RUNTIME_BACKFILLS } from '../../db/access-runtime-backfill';
import { ACCESS_RUNTIME_TRIGGERS } from '../../db/access-runtime-triggers';
import { ACCESS_TRIGGERS } from '../../db/access-triggers';

/** Rebuild only the dedicated test binding. Never reset the application's permanent runtime floor. */
export async function resetAccessRuntimeFixture({
  guards = true,
  seed = true,
  unchecked = false,
  generation = 0,
}: {
  guards?: boolean;
  seed?: boolean;
  unchecked?: boolean;
  generation?: number;
} = {}) {
  const db = env.ACCESS_RUNTIME_DB;
  const runtimeTable = env.TEST_D1_MIGRATIONS.flatMap((m) => m.queries).find(
    (sql) => sql.startsWith('CREATE TABLE `access_runtime_state`')
  );
  if (!runtimeTable) throw new Error('Runtime migration fixture is missing.');
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS access_runtime_state'),
    db.prepare('DROP TABLE IF EXISTS access_control_state'),
    db.prepare('DROP TABLE IF EXISTS teams'),
    db.prepare(
      'CREATE TABLE teams (id TEXT PRIMARY KEY, membership_mode TEXT)'
    ),
    db.prepare(
      'CREATE TABLE access_control_state (id INTEGER PRIMARY KEY, generation INTEGER NOT NULL, legacy_shared_team_id TEXT)'
    ),
    db
      .prepare(
        'INSERT INTO access_control_state (id, generation) VALUES (1, ?)'
      )
      .bind(generation),
    db.prepare(
      unchecked
        ? 'CREATE TABLE access_runtime_state (id, minimum_protocol, schema_mode, role_publishing_enabled, revision)'
        : runtimeTable
    ),
    ...(!guards
      ? []
      : [
          ...ACCESS_TRIGGERS.filter(
            (trigger) => trigger.name === 'cloudforge_access_state_update_v1'
          ),
          ...ACCESS_RUNTIME_TRIGGERS,
        ].map((trigger) => db.prepare(trigger.sql))),
    ...(!seed
      ? []
      : ACCESS_RUNTIME_BACKFILLS.flatMap((entry) =>
          entry.statements.map((sql) => db.prepare(sql))
        )),
  ]);
  return db;
}
