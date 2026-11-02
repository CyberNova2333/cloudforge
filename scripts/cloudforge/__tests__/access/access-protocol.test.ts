// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAccessProtocol } from '../../access/access-protocol.ts';

let root: string;
let migrationsDir: string;
const descriptor = new URL('../../../../access-protocol.json', import.meta.url);
const migration = new URL(
  '../../../../migrations/0065_silent_albert_cleary.sql',
  import.meta.url
);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-access-protocol-'));
  migrationsDir = join(root, 'migrations');
  mkdirSync(migrationsDir);
  copyFileSync(descriptor, join(root, 'access-protocol.json'));
  const sourceMigrations = new URL('../../../../migrations/', import.meta.url);
  for (const name of readdirSync(sourceMigrations).filter((n) =>
    n.endsWith('.sql')
  ))
    copyFileSync(new URL(name, sourceMigrations), join(migrationsDir, name));
});
afterEach(() => {
  const absolute = resolve(root);
  if (
    !absolute.startsWith(
      resolve(tmpdir()) + sep + 'cloudforge-access-protocol-'
    )
  )
    throw new Error('Unexpected cleanup target');
  rmSync(absolute, { recursive: true, force: true });
});
const read = () => readAccessProtocol({ root, migrationsDir });
const change = (update: (value: Record<string, unknown>) => void) => {
  const file = join(root, 'access-protocol.json');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  update(value);
  writeFileSync(file, JSON.stringify(value));
};

describe('升级源码权限协议', () => {
  it('接受实际声明和迁移，返回独立的不可扩权契约', () => {
    const first = read();
    expect(first.targetSchema).toBe('runtime-bridge-v1');
    expect(first.acceptedSchemas).toEqual([
      'legacy',
      'compat-v1',
      'runtime-bridge-v1',
    ]);
    expect(first.runtimeProtocol).toBe(1);
    first.migration.sha256 = 'changed';
    expect(read().migration.sha256).not.toBe('changed');
  });

  it('仅允许 Git 的 CRLF 换行转换', () => {
    const sql = readFileSync(migration, 'utf8').replace(/\r?\n/g, '\r\n');
    writeFileSync(join(migrationsDir, '0065_silent_albert_cleary.sql'), sql);
    expect(read().targetSchema).toBe('runtime-bridge-v1');
  });

  it.each([
    [
      'unknown target',
      (v: Record<string, unknown>) => (v.targetSchema = 'roles-v2'),
    ],
    [
      'extra accepted schema',
      (v: Record<string, unknown>) =>
        (v.acceptedSchemas = ['legacy', 'compat-v1', 'roles-v2']),
    ],
    ['unknown field', (v: Record<string, unknown>) => (v.allowUnsafe = true)],
    [
      'path traversal',
      (v: Record<string, unknown>) =>
        (v.migration = { name: '../secret', sha256: 'x' }),
    ],
    ['unknown format', (v: Record<string, unknown>) => (v.format = 2)],
    [
      'false runtime declaration',
      (v: Record<string, unknown>) => (v.runtimeProtocol = 2),
    ],
  ])('拒绝 %s', (_name, update) => {
    change(update);
    expect(read).toThrow(
      'missing, unsupported or inconsistent access protocol'
    );
  });

  it('确认计划后改动迁移及相邻摘要也不能重新定义 CLI 支持范围', () => {
    read();
    const sql = readFileSync(migration, 'utf8') + '\n-- changed after plan\n';
    writeFileSync(join(migrationsDir, '0065_silent_albert_cleary.sql'), sql);
    expect(read).toThrow('access protocol');
    change((value) => {
      (value.migration as { sha256: string }).sha256 = createHash('sha256')
        .update(sql)
        .digest('hex');
    });
    expect(read).toThrow('access protocol');
  });

  it.each(['added', 'removed', 'renamed', 'changed'] as const)(
    '在任何迁移之前拒绝完整迁移集合被 %s',
    (operation) => {
      read();
      const file = join(migrationsDir, '0064_third_azazel.sql');
      if (operation === 'added')
        writeFileSync(
          join(migrationsDir, '0065_future_acl.sql'),
          'CREATE TABLE team_members(id TEXT);'
        );
      else if (operation === 'removed') rmSync(file);
      else if (operation === 'renamed') {
        copyFileSync(file, join(migrationsDir, '0064_different.sql'));
        rmSync(file);
      } else writeFileSync(file, 'DROP TABLE repository_collaborators;');
      expect(read).toThrow('access protocol');
    }
  );

  it('文件缺失或过大时关闭，诊断不带文件内容或路径', () => {
    const marker = 'private-owner@example.invalid';
    writeFileSync(join(root, 'access-protocol.json'), marker.repeat(200));
    try {
      read();
      expect.fail('must refuse oversized descriptor');
    } catch (error) {
      expect(String(error)).not.toContain(marker);
      expect(String(error)).not.toContain(root);
    }
    rmSync(join(root, 'access-protocol.json'));
    expect(read).toThrow('access protocol');
  });
});
