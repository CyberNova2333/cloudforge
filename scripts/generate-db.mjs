// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Drizzle owns table migrations; these declarations add SQLite triggers it cannot represent.
// Only append to a migration created during this invocation, never to existing history.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveYarnCommand } from './githooks/run-yarn.mjs';
import {
  RECOVERY_TRIGGER_NAME,
  RECOVERY_TRIGGER_SQL,
} from '../worker/src/db/recovery-trigger.ts';
import { AUTH_TRIGGERS } from '../worker/src/db/auth-triggers.ts';
import { OAUTH_GRANT_TRIGGERS } from '../worker/src/db/oauth-grant-triggers.ts';
import { AUTH_POLICY_TRIGGERS } from '../worker/src/db/auth-policy-triggers.ts';
import { OIDC_TRIGGERS } from '../worker/src/db/oidc-triggers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalized = (sql) =>
  sql.replace(/\r\n/g, '\n').trim().replace(/;+$/, '');
const definitions = [
  { name: RECOVERY_TRIGGER_NAME, sql: RECOVERY_TRIGGER_SQL },
  ...AUTH_TRIGGERS,
  ...OAUTH_GRANT_TRIGGERS,
  ...AUTH_POLICY_TRIGGERS,
  ...OIDC_TRIGGERS,
];
const validName = (name) =>
  typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);

function runDrizzle(args, cwd) {
  let invocation;
  const env = process.env;
  if (/^yarn\//.test(env.npm_config_user_agent ?? '') && env.npm_execpath) {
    const entry = env.npm_execpath;
    if (
      !isAbsolute(entry) ||
      !['.js', '.mjs', '.cjs'].includes(extname(entry)) ||
      !statSync(entry).isFile()
    )
      throw new Error('Yarn 生命周期没有提供可用的 JavaScript 入口。');
    invocation = { command: process.execPath, args: [entry] };
  } else invocation = resolveYarnCommand({ cwd, env });
  const result = spawnSync(
    invocation.command,
    [...invocation.args, 'drizzle-kit', 'generate', ...args],
    {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal)
    throw new Error('Drizzle migration generation failed.');
}

/** `run` is injected in tests so filesystem/history guarantees are exercised without a database. */
export function generateDatabase({
  root = ROOT,
  run = runDrizzle,
  triggers = definitions,
} = {}) {
  const directory = join(root, 'migrations');
  // Drizzle treats every meta filename not starting with '_' as a schema snapshot.
  const stateFile = join(directory, 'meta', '_triggers.json');
  const previous = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, 'utf8'))
    : { version: 1, triggers: [] };
  if (
    previous.version !== 1 ||
    !Array.isArray(previous.triggers) ||
    previous.triggers.some(
      (item) => !validName(item.name) || !/^[a-f0-9]{64}$/.test(item.sha256)
    )
  )
    throw new Error('Invalid generated trigger metadata.');
  if (
    triggers.some(
      (item) =>
        !validName(item.name) ||
        typeof item.sql !== 'string' ||
        !normalized(item.sql)
    )
  )
    throw new Error('Invalid trigger declaration.');
  if (
    new Set(triggers.map((item) => item.name)).size !== triggers.length ||
    new Set(previous.triggers.map((item) => item.name)).size !==
      previous.triggers.length
  )
    throw new Error('Duplicate trigger declaration.');
  const current = {
    version: 1,
    triggers: triggers.map((item) => ({
      name: item.name,
      sha256: digest(normalized(item.sql)),
    })),
  };
  const changed = JSON.stringify(current) !== JSON.stringify(previous);
  const files = () =>
    readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  const before = new Map(
    files().map((name) => [name, digest(readFileSync(join(directory, name)))])
  );
  const generated = () => {
    for (const [name, hash] of before)
      if (
        !existsSync(join(directory, name)) ||
        digest(readFileSync(join(directory, name))) !== hash
      )
        throw new Error(`Generation modified an existing migration: ${name}`);
    return files().filter((name) => !before.has(name));
  };
  run([], root);
  let added = generated();
  if (!added.length && changed) {
    run(['--custom', '--name', 'auth_triggers'], root);
    added = generated();
  }
  if (!added.length) {
    if (changed)
      throw new Error(
        'Drizzle did not create a migration for the trigger changes.'
      );
    return null;
  }
  if (added.length !== 1)
    throw new Error('Expected exactly one new Drizzle migration.');
  const migration = added[0];
  const journal = JSON.parse(
    readFileSync(join(directory, 'meta', '_journal.json'), 'utf8')
  );
  if (journal.entries.at(-1)?.tag !== basename(migration, '.sql'))
    throw new Error('The new migration does not match the Drizzle journal.');
  // Cross-table triggers survive DROP of a referenced table, then make ALTER RENAME
  // fail while that table is absent. Remove existing triggers before Drizzle's DDL,
  // and recreate declarations only after every referenced table exists again.
  const names = [
    ...new Set([
      ...previous.triggers.map((item) => item.name),
      ...triggers.map((item) => item.name),
    ]),
  ];
  const drops = names.map((name) => `DROP TRIGGER IF EXISTS \`${name}\`;`);
  const creates = triggers.map((item) => `${normalized(item.sql)};`);
  const prefix = previous.triggers.length ? drops : [];
  const suffix = previous.triggers.length ? creates : [...drops, ...creates];
  if (prefix.length || suffix.length) {
    const path = join(directory, migration);
    const sql = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    writeFileSync(
      path,
      [...prefix, sql, ...suffix].join('\n--> statement-breakpoint\n') + '\n'
    );
  }
  if (changed)
    writeFileSync(stateFile, JSON.stringify(current, null, 2) + '\n');
  return migration;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const migration = generateDatabase();
    if (migration)
      process.stdout.write(
        `Generated managed triggers in migrations/${migration}\n`
      );
  } catch (error) {
    process.stderr.write(`Database generation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
