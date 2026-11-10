// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('签名历史元数据证明保持真实钩子和安全扫描边界', () => {
  const python = [['python3'], ['python'], ['py', '-3']].find(
    ([command, ...prefix]) =>
      spawnSync(command, [
        ...prefix,
        '-c',
        'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)',
      ]).status === 0
  );
  expect(python, '需要 Python 3.10+ 和 ssh-keygen').toBeDefined();
  const [command, ...prefix] = python!;
  const result = spawnSync(
    command,
    [
      ...prefix,
      '-B',
      '-X',
      'utf8',
      fileURLToPath(
        new URL('./history_metadata_proof_test.py', import.meta.url)
      ),
    ],
    { encoding: 'utf8', timeout: 180_000 }
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
}, 190_000);
