// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const { beforeUnlink } = vi.hoisted(() => ({
  beforeUnlink: vi.fn<(path: unknown) => void>(),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    unlinkSync(path: Parameters<typeof actual.unlinkSync>[0]) {
      beforeUnlink(path);
      actual.unlinkSync(path);
    },
  };
});

let root: string;
let checkout: string;
let home: string;

beforeEach(() => {
  beforeUnlink.mockReset();
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

/** Inject one syscall failure; creation, hard links and subsequent cleanup stay real. */
function failConfigCleanupOnce(config: string): () => string {
  let retained: string | undefined;
  beforeUnlink.mockImplementation((path) => {
    if (retained === undefined && String(path).startsWith(`${config}.adopt-`)) {
      retained = String(path);
      throw Object.assign(new Error('temporary cleanup denied'), {
        code: 'EACCES',
      });
    }
  });
  return () => {
    expect(retained).toBeDefined();
    return retained!;
  };
}

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

  it('临时文件清理失败后仍完成状态与来源标记', async () => {
    const s = seed('acme', 'acme-111111111111');
    const source = '// complete source\n{}';
    writeFileSync(join(checkout, 'wrangler.jsonc'), source);
    const dest = join(home, s.names.worker);
    const config = join(dest, 'wrangler.jsonc');
    const retained = failConfigCleanupOnce(config);

    await expect(adopt()).resolves.toEqual({ slug: s.names.worker, dir: dest });

    expect(readFileSync(config, 'utf8')).toBe(source);
    expect(readState(dest, s.installationId)!.adoptedAt).toBe(
      now().toISOString()
    );
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBe(dest);
    expect(readFileSync(retained(), 'utf8')).toBe(source);
    expect(statSync(retained()).mode & 0o777).toBe(0o600);
  });

  it('临时文件清理失败不丢失后续失败所需的配置回滚', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const dest = join(home, s.names.worker);
    const config = join(dest, 'wrangler.jsonc');
    const retained = failConfigCleanupOnce(config);
    const failure = new Error('state preparation failed');

    await expect(
      adoptFromCheckout({
        checkout,
        home,
        io,
        now: () => {
          throw failure;
        },
      })
    ).rejects.toBe(failure);

    expect(existsSync(config)).toBe(false);
    expect(readState(dest, s.installationId)).toBeNull();
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
    expect(readFileSync(retained(), 'utf8')).toBe('{}');
  });

  it('临时文件清理失败不覆盖目标已占用的主错误', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '// source\n{}');
    const dest = join(home, s.names.worker);
    const config = join(dest, 'wrangler.jsonc');
    mkdirSync(dest, { recursive: true });
    writeFileSync(config, '// independently maintained');
    const retained = failConfigCleanupOnce(config);

    await expect(adopt()).rejects.toThrow('already exists');

    expect(readFileSync(config, 'utf8')).toBe('// independently maintained');
    expect(readState(dest, s.installationId)).toBeNull();
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
    expect(readFileSync(retained(), 'utf8')).toBe('// source\n{}');
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

  it('目标有手写配置但没有状态时也拒绝覆盖', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '// source\n{}');
    const dest = join(home, s.names.worker);
    mkdirSync(dest, { recursive: true });
    const manual = '// hand maintained\n{"name":"keep-me"}';
    writeFileSync(join(dest, 'wrangler.jsonc'), manual);
    await expect(adopt()).rejects.toThrow('already exists');
    expect(readFileSync(join(dest, 'wrangler.jsonc'), 'utf8')).toBe(manual);
    expect(readState(dest, s.installationId)).toBeNull();
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
  });

  it('目标配置是断开的符号链接时不覆盖也不写链接目标', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const dest = join(home, s.names.worker);
    const target = join(root, 'missing-config');
    mkdirSync(dest, { recursive: true });
    symlinkSync(target, join(dest, 'wrangler.jsonc'));
    await expect(adopt()).rejects.toThrow('already exists');
    expect(existsSync(target)).toBe(false);
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
  });

  it('中断清理保留目标目录中途新增的其他文件', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const dest = join(home, s.names.worker);
    await expect(
      adoptFromCheckout({
        checkout,
        home,
        io,
        now: () => {
          writeFileSync(join(dest, 'keep.txt'), 'another writer');
          throw new Error('interrupted');
        },
      })
    ).rejects.toThrow('interrupted');
    expect(readFileSync(join(dest, 'keep.txt'), 'utf8')).toBe('another writer');
    expect(existsSync(join(dest, 'wrangler.jsonc'))).toBe(false);
    expect(readState(dest, s.installationId)).toBeNull();
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
  });

  it('中断清理不删除已经被其他写入者修改的配置', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const dest = join(home, s.names.worker);
    await expect(
      adoptFromCheckout({
        checkout,
        home,
        io,
        now: () => {
          writeFileSync(
            join(dest, 'wrangler.jsonc'),
            '// changed by another writer'
          );
          throw new Error('interrupted');
        },
      })
    ).rejects.toThrow('interrupted');
    expect(readFileSync(join(dest, 'wrangler.jsonc'), 'utf8')).toBe(
      '// changed by another writer'
    );
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
  });

  it('状态写入也不能替换刚被其他写入者创建的文件', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const dest = join(home, s.names.worker);
    await expect(
      adoptFromCheckout({
        checkout,
        home,
        io,
        now: () => {
          writeState(dest, { ...s, deployedVersion: 'other-writer' });
          return now();
        },
      })
    ).rejects.toThrow(/EEXIST/);
    expect(readState(dest, s.installationId)!.deployedVersion).toBe(
      'other-writer'
    );
    expect(existsSync(join(dest, 'wrangler.jsonc'))).toBe(false);
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
  });

  it('来源标记写入失败时撤回本次新建的状态与配置', async () => {
    const s = seed('acme', 'acme-111111111111');
    writeFileSync(join(checkout, 'wrangler.jsonc'), '{}');
    const dest = join(home, s.names.worker);
    await expect(
      adoptFromCheckout({
        checkout,
        home,
        io,
        now: () => {
          mkdirSync(
            join(checkout, '.cloudforge', `${s.installationId}.json.tmp`)
          );
          return now();
        },
      })
    ).rejects.toThrow();
    expect(existsSync(dest)).toBe(false);
    expect(
      readState(join(checkout, '.cloudforge'), s.installationId)!.movedTo
    ).toBeUndefined();
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
