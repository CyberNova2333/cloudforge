// CloudForge fork (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { InstallState } from '../state.ts';
import type { FakeCloudflareSeed } from './fakes.ts';
export const ACCESS_MIGRATION = '0063_rare_skin.sql';
const migrations = new URL('../../../migrations/', import.meta.url);
export const ACCESS_MIGRATIONS = readdirSync(migrations)
  .filter((name) => name.endsWith('.sql'))
  .sort();
export const ACCESS_PENDING_MIGRATION = ACCESS_MIGRATIONS.at(-1)!;
const databases: DatabaseSync[] = [];
export function closeAccessDatabases() {
  for (const db of databases.splice(0)) db.close();
}
export function copyAccessProtocol(root: string) {
  mkdirSync(join(root, 'migrations'), { recursive: true });
  copyFileSync(
    new URL('../../../access-protocol.json', import.meta.url),
    join(root, 'access-protocol.json')
  );
  for (const name of ACCESS_MIGRATIONS)
    copyFileSync(new URL(name, migrations), join(root, 'migrations', name));
}
/** Executes the actual SELECTs against real SQLite; transport remains fake, SQL does not. */
export function accessDatabase(
  state: InstallState,
  id: string,
  legacy = false,
  empty = false
) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  if (!empty) migrateAccessDatabase(db, legacy);
  if (!empty && (!state.adoptedAt || state.upgradedAt))
    db.prepare(
      'INSERT INTO install_state (installation_id, ownership_nonce, updated_at) VALUES (?,?,0)'
    ).run(state.installationId, state.ownershipNonce);
  const seed: Pick<FakeCloudflareSeed, 'd1Query' | 'd1Tables'> = {
    d1Tables: {
      [id]: db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all()
        .map((row) => String(row.name)),
    },
    d1Query: (_id, sql, params) =>
      db.prepare(sql).all(...(params as (string | number | null)[])),
  };
  return { db, seed };
}

export function migrateAccessDatabase(db: DatabaseSync, legacy = false) {
  for (const name of readdirSync(migrations)
    .filter(
      (name) =>
        name.endsWith('.sql') && (!legacy || Number(name.slice(0, 4)) <= 62)
    )
    .sort())
    db.exec(readFileSync(new URL(name, migrations), 'utf8'));
}
