// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error: plain JavaScript module, no types
import { findWrangler } from './lib.mjs';

it('seeding runs the local Wrangler Node entry without executing shell shims', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloudforge seed '));
  try {
    const entry = join(root, 'node_modules/wrangler/bin/wrangler.js');
    const shim = join(root, 'node_modules/.bin/wrangler');
    mkdirSync(dirname(entry), { recursive: true });
    mkdirSync(dirname(shim), { recursive: true });
    writeFileSync(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
    writeFileSync(shim, '#!/bin/sh\nexit 9\n');
    const invocation = findWrangler(root);
    expect(invocation).toEqual({ command: process.execPath, args: [entry] });
    const args = ['d1', 'two words', '& literal'];
    const result = spawnSync(
      invocation.command,
      [...invocation.args, ...args],
      { encoding: 'utf8', shell: false, windowsHide: true }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(findWrangler(root, '/explicit/wrangler')).toEqual({
      command: '/explicit/wrangler',
      args: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
