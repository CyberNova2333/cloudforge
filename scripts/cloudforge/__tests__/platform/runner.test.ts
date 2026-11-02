// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { processRunner } from '../../platform/runner.ts';

it('runs Yarn through a real process and preserves literal arguments and stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cloudforge-yarn-process-'));
  const entry = join(dir, 'yarn.cjs');
  const program = `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => input += s); process.stdin.on('end', () => console.log(JSON.stringify({args: process.argv.slice(2), input})));`;
  writeFileSync(entry, program);
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'yarn.cmd'), '@node "%~dp0\\yarn.cjs" %*\r\n');
  } else {
    writeFileSync(join(dir, 'yarn'), `#!${process.execPath}\n${program}`);
    chmodSync(join(dir, 'yarn'), 0o755);
  }
  const args = ['--version', 'two words', 'a&b', '$(literal)', '%PATH%'];
  const result = await processRunner.run('yarn', args, {
    cwd: dir,
    env: { PATH: dir, PATHEXT: '.CMD;.EXE' },
    input: 'private stdin fixture',
  });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    args,
    input: 'private stdin fixture',
  });
});
