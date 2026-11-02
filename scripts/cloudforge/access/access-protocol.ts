// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Source } from '../distribution/source.ts';

/** A declaration understood by this CLI, not an attestation of deployed Worker code. */
export type AccessProtocol = {
  format: 1;
  targetSchema: 'runtime-bridge-v1';
  acceptedSchemas: ['legacy', 'compat-v1', 'runtime-bridge-v1'];
  runtimeProtocol: 1;
  migration: { name: string; sha256: string };
  migrationSetSha256: string;
};

// Deliberately pinned in the CLI as well as the shipped descriptor. Editing both the
// migration and its adjacent JSON must not silently redefine what this CLI supports.
const EXPECTED: AccessProtocol = {
  format: 1,
  targetSchema: 'runtime-bridge-v1',
  acceptedSchemas: ['legacy', 'compat-v1', 'runtime-bridge-v1'],
  runtimeProtocol: 1,
  migration: {
    name: '0065_silent_albert_cleary.sql',
    sha256: 'b0f336dcef791573dc2c370d7c00db59b36715875e476aa0db3205283dca7897',
  },
  migrationSetSha256:
    '97782c8cd0130e25b53c46eccc003e4b2a48d3aaf9d499b91b58fd5444e97a9d',
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
        'runtimeProtocol',
        'migration',
        'migrationSetSha256',
      ]) ||
      value.format !== EXPECTED.format ||
      value.targetSchema !== EXPECTED.targetSchema ||
      value.runtimeProtocol !== EXPECTED.runtimeProtocol ||
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
    if (files.length !== 66) throw new Error('Unexpected migration set');
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
