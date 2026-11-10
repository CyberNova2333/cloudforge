// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { processRunner } from '../../platform/runner.ts';

it('runs pnpm through a real process and preserves literal arguments and stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cloudforge-pnpm-process-'));
  const entry = join(dir, 'pnpm.cjs');
  const program = `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => input += s); process.stdin.on('end', () => console.log(JSON.stringify({args: process.argv.slice(2), input})));`;
  writeFileSync(entry, program);
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'pnpm.cmd'), '@node "%~dp0\\pnpm.cjs" %*\r\n');
  } else {
    writeFileSync(join(dir, 'pnpm'), `#!${process.execPath}\n${program}`);
    chmodSync(join(dir, 'pnpm'), 0o755);
  }
  const args = ['--version', 'two words', 'a&b', '$(literal)', '%PATH%'];
  const result = await processRunner.run('pnpm', args, {
    cwd: dir,
    env: {
      ...Object.fromEntries(
        Object.keys(process.env)
          .filter((key) =>
            ['npm_execpath', 'npm_config_user_agent'].includes(
              key.toLowerCase()
            )
          )
          .map((key) => [key, ''])
      ),
      PATH: dir,
      PATHEXT: '.CMD;.EXE',
    },
    input: 'private stdin fixture',
  });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    args,
    input: 'private stdin fixture',
  });
});

it('reuses the native pnpm lifecycle entry without evaluating PATH wrappers', async () => {
  const program = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
  const args = ['two words', '& literal', '%PATH%'];
  const result = await processRunner.run(
    'pnpm',
    ['-e', program, '--', ...args],
    {
      env: {
        npm_config_user_agent: 'pnpm/12.6.0',
        npm_execpath: process.execPath,
      },
    }
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(args);
});
