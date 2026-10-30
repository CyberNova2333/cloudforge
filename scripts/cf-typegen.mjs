#!/usr/bin/env node
// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Regenerates worker/worker-configuration.d.ts from wrangler.jsonc.ci, not the local config.
 * `wrangler types` still reads ./wrangler.jsonc, so the CI config is swapped in and the local one
 * restored after (a crash leaves it at .wrangler.jsonc.local-backup).
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, isAbsolute } from 'node:path';
import { runYarn } from './githooks/run-yarn.mjs';

const LOCAL = 'wrangler.jsonc';
const CI = 'wrangler.jsonc.ci';
const BACKUP = '.wrangler.jsonc.local-backup';
const OUTPUT = 'worker/worker-configuration.d.ts';
const NOTICE =
  '// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).';

if (!existsSync(CI)) {
  console.error(`cf-typegen: ${CI} is missing`);
  process.exit(1);
}
if (existsSync(BACKUP)) {
  console.error(
    `cf-typegen: ${BACKUP} already exists — a previous run crashed. ` +
      `Restore it to ${LOCAL} or delete it, then retry.`
  );
  process.exit(1);
}

const hadLocal = existsSync(LOCAL);
if (hadLocal) renameSync(LOCAL, BACKUP);

let exitCode = 0;
try {
  copyFileSync(CI, LOCAL);
  const args = [
    'wrangler',
    'types',
    OUTPUT,
    '--env-interface',
    'CloudflareBindings',
  ];
  let result;
  // Yarn 1's temporary lifecycle shim is not a standard Corepack launcher. Invoke its verified JS entry directly.
  if (/^yarn\//.test(process.env.npm_config_user_agent ?? '')) {
    const entry = process.env.npm_execpath;
    if (
      !entry ||
      !isAbsolute(entry) ||
      !['.js', '.mjs', '.cjs'].includes(extname(entry)) ||
      !statSync(entry).isFile()
    )
      throw new Error('Yarn 生命周期没有提供可用的 JavaScript 入口。');
    result = spawnSync(process.execPath, [entry, ...args], {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });
  } else result = runYarn(args, { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  exitCode = result.status ?? 1;
  if (exitCode === 0) {
    // This header is part of the generated artifact, never a manual edit to protected output.
    const generated = readFileSync(OUTPUT, 'utf8');
    if (
      !generated.startsWith(NOTICE + '\n') &&
      !generated.startsWith(NOTICE + '\r\n')
    )
      writeFileSync(OUTPUT, NOTICE + '\n' + generated);
  }
} finally {
  if (hadLocal) renameSync(BACKUP, LOCAL);
  else if (existsSync(LOCAL)) unlinkSync(LOCAL);
}

process.exit(exitCode);
