// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Source } from './source.ts';

/** A declaration understood by this CLI, not an attestation of deployed Worker code. */
export type AccessProtocol = {
  format: 1;
  targetSchema: 'compat-v1';
  acceptedSchemas: ['legacy', 'compat-v1'];
  migration: { name: string; sha256: string };
  migrationSetSha256: string;
};

// Deliberately pinned in the CLI as well as the shipped descriptor. Editing both the
// migration and its adjacent JSON must not silently redefine what this CLI supports.
const EXPECTED: AccessProtocol = {
  format: 1,
  targetSchema: 'compat-v1',
  acceptedSchemas: ['legacy', 'compat-v1'],
  migration: {
    name: '0063_rare_skin.sql',
    sha256: '224e6ff6e1252113e99e798c1308606ac3270f76d28367e2775ef5593261f001',
  },
  migrationSetSha256:
    'c591f4470ad367d9d09f53d6233a2f279e04dd6828d3671a589275fd29cca9f6',
};
const keys = (
  value: unknown,
  names: string[]
): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === names.sort().join('\0');

function boundedFile(path: string, max: number): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > max) throw new Error('Invalid file');
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > max) throw new Error('Invalid file');
  return text;
}

/** Re-read on each call: plan-time inspection does not authorize changed source files. */
export function readAccessProtocol(
  source: Pick<Source, 'root' | 'migrationsDir'>
): AccessProtocol {
  try {
    const value: unknown = JSON.parse(
      boundedFile(join(source.root, 'access-protocol.json'), 4096)
    );
    if (
      !keys(value, [
        'format',
        'targetSchema',
        'acceptedSchemas',
        'migration',
        'migrationSetSha256',
      ]) ||
      value.format !== EXPECTED.format ||
      value.targetSchema !== EXPECTED.targetSchema ||
      JSON.stringify(value.acceptedSchemas) !==
        JSON.stringify(EXPECTED.acceptedSchemas) ||
      !keys(value.migration, ['name', 'sha256']) ||
      value.migration.name !== EXPECTED.migration.name ||
      value.migration.sha256 !== EXPECTED.migration.sha256 ||
      value.migrationSetSha256 !== EXPECTED.migrationSetSha256
    )
      throw new Error('Unsupported protocol');
    // Git's CRLF checkout conversion does not change SQL semantics. No other
    // whitespace or SQL token normalization is allowed for this fingerprint.
    const sql = boundedFile(
      join(source.migrationsDir, EXPECTED.migration.name),
      1_000_000
    ).replace(/\r\n/g, '\n');
    if (
      createHash('sha256').update(sql).digest('hex') !==
      EXPECTED.migration.sha256
    )
      throw new Error('Migration fingerprint mismatch');
    const files = readdirSync(source.migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    if (files.length !== 65) throw new Error('Unexpected migration set');
    const entries = files.map((name) => [
      name,
      createHash('sha256')
        .update(
          boundedFile(join(source.migrationsDir, name), 1_000_000).replace(
            /\r\n/g,
            '\n'
          )
        )
        .digest('hex'),
    ]);
    if (
      createHash('sha256').update(JSON.stringify(entries)).digest('hex') !==
      EXPECTED.migrationSetSha256
    )
      throw new Error('Migration set fingerprint mismatch');
    return structuredClone(EXPECTED);
  } catch {
    throw new Error(
      'The upgrade source has a missing, unsupported or inconsistent access protocol. Use an intact compatible release; nothing was changed by this check.'
    );
  }
}
