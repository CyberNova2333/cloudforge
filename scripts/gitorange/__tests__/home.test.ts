// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cloudforgeHome,
  installDir,
  listInstalls,
  pickInstall,
} from '../home.ts';
import { installationIdOf, resourceNames } from '../names.ts';
import { UsageError } from '../status.ts';
import { newState, statePath, writeState } from '../state.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cloudforge-home-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const put = (name: string) => {
  const id = installationIdOf('a'.repeat(32), name, 'workers.dev');
  const dir = installDir(home, name);
  mkdirSync(dir, { recursive: true });
  writeState(
    dir,
    newState({
      installationId: id,
      accountId: 'a'.repeat(32),
      inputs: { name, hostname: null, workersDev: true, fromEmail: null },
      names: resourceNames(name),
      baseUrl: '',
    })
  );
  return statePath(dir, id);
};

describe('cloudforgeHome：安装主目录', () => {
  it('优先使用 CLOUDFORGE_HOME，否则使用 ~/.cloudforge', () => {
    expect(cloudforgeHome({ CLOUDFORGE_HOME: '/x/y' })).toBe('/x/y');
    expect(cloudforgeHome({})).toBe(join(homedir(), '.cloudforge'));
  });
});

describe('pickInstall：选择安装', () => {
  it('多个安装需要 --name', () => {
    const a = put('acme');
    const b = put('beta');
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(a, old, old);
    utimesSync(b, old, old);
    expect(() => pickInstall(home, undefined)).toThrow(UsageError);
    expect(() => pickInstall(home, undefined)).toThrow(
      'Several installs: acme, beta. Pass --name.'
    );
    expect(statSync(a).mtimeMs).toBe(old.getTime());
    expect(statSync(b).mtimeMs).toBe(old.getTime());
    expect(pickInstall(home, 'beta').slug).toBe('beta');
  });

  it('选择唯一安装', () => {
    put('acme');
    expect(pickInstall(home, undefined).slug).toBe('acme');
    expect(listInstalls(home).map((i) => i.slug)).toEqual(['acme']);
  });

  it('主目录为空', () => {
    expect(() => pickInstall(home, undefined)).toThrow(
      `No CloudForge install in ${home}.`
    );
    expect(() => pickInstall(join(home, 'missing'), undefined)).toThrow(
      UsageError
    );
  });
});

describe('listInstalls：列出安装', () => {
  it('跳过文件和失效符号链接', () => {
    put('acme');
    writeFileSync(join(home, 'note.txt'), 'x');
    symlinkSync(join(home, 'nowhere'), join(home, 'dangling'));
    expect(listInstalls(home).map((i) => i.slug)).toEqual(['acme']);
  });
});
