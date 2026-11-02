// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adoptFromCheckout } from '../../commands/adopt.ts';
import type { Io } from '../../ui/collect.ts';
import { installationIdOf, resourceNames } from '../../planning/names.ts';
import { UsageError } from '../../commands/status.ts';
import {
  newState,
  readState,
  writeState,
  type InstallState,
} from '../../installation/state.ts';

let root: string;
let checkout: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-adopt-'));
  checkout = join(root, 'repo');
  home = join(root, 'home');
  mkdirSync(checkout, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const io = { print() {} } as unknown as Io;
const now = () => new Date('2026-10-17T12:00:00Z');

function seed(name: string, id: string): InstallState {
  const s: InstallState = {
    ...newState({
      installationId: id,
      accountId: 'a'.repeat(32),
      inputs: {
        name,
        hostname: null,
        workersDev: true,
        fromEmail: null,
      },
      names: resourceNames(name),
      baseUrl: `https://${name}.me.workers.dev`,
    }),
    status: 'installed',
  };
  writeState(join(checkout, '.cloudforge'), s);
  return s;
}

const adopt = (name?: string) =>
  adoptFromCheckout({ checkout, home, name, io, now });

describe('adoptFromCheckout：从源码检出目录接管', () => {
  it('复制状态和配置并标记检出目录', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '// config\n{}\n');
    const r = await adopt();
    expect(r.slug).toBe(s.names.worker);
    expect(r.dir).toBe(join(home, s.names.worker));
    const moved = readState(r.dir, s.installationId)!;
    expect(moved.adoptedAt).toBe('2026-10-17T12:00:00.000Z');
    expect(moved.movedTo).toBeUndefined();
    expect(moved.ownershipNonce).toBe(s.ownershipNonce);
    expect(readFileSync(join(r.dir, 'wrangler.jsonc'), 'utf8')).toBe(
      '// config\n{}\n'
    );
    const stub = readState(join(checkout, '.cloudforge'), s.installationId)!;
    expect(stub.movedTo).toBe(r.dir);
    // No lock files are left behind.
    expect(existsSync(join(r.dir, `${s.installationId}.lock`))).toBe(false);
    expect(
      existsSync(join(checkout, '.cloudforge', `${s.installationId}.lock`))
    ).toBe(false);
  });

  it('多个源码安装需要 --name', async () => {
    seed('acme', 'acme-111111111111');
    seed('beta', 'beta-222222222222');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    await expect(adopt()).rejects.toThrow(UsageError);
    await expect(adopt()).rejects.toThrow(/acme, beta/);
    const r = await adopt('beta');
    expect(r.slug).toBe(resourceNames('beta').worker);
  });

  it('目标位置已占用时停止且保留检出目录', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const dest = join(home, s.names.worker);
    writeState(dest, { ...s, deployedVersion: '9.9.9' });
    const before = readFileSync(
      join(checkout, '.cloudforge', `${s.installationId}.json`),
      'utf8'
    );
    await expect(adopt()).rejects.toThrow(`${dest} already has an install`);
    expect(
      readFileSync(
        join(checkout, '.cloudforge', `${s.installationId}.json`),
        'utf8'
      )
    ).toBe(before);
    expect(readState(dest, s.installationId)!.deployedVersion).toBe('9.9.9');
    expect(existsSync(join(dest, 'wrangler.jsonc'))).toBe(false);
  });

  it('失败后不遗留目标目录', async () => {
    const s = seed('acme', 'acme-111111111111');
    // No wrangler.jsonc in the checkout.
    await expect(adopt()).rejects.toThrow(/wrangler\.jsonc is missing/);
    expect(existsSync(join(home, s.names.worker))).toBe(false);
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
  });

  it('已迁移的安装不会被再次接管', async () => {
    seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    await adopt();
    await expect(adopt()).rejects.toThrow(/already moved/);
  });

  it('文件权限为 0600，目录权限为 0700', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const r = await adopt();
    const mode = (p: string) => statSync(p).mode & 0o777;
    expect(mode(r.dir)).toBe(0o700);
    expect(mode(join(r.dir, `${s.installationId}.json`))).toBe(0o600);
    expect(mode(join(r.dir, 'wrangler.jsonc'))).toBe(0o600);
  });
});
