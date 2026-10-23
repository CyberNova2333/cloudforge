// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import {
  mkdirSync,
  readFileSync,
  mkdtempSync,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resourceNames } from '../names.ts';
import {
  acquireLock,
  hasStep,
  listStates,
  newState,
  readState,
  recordResource,
  recordStep,
  statePath,
  transition,
  writeState,
  type Status,
} from '../state.ts';

let dir: string;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'go-state-')), '.cloudforge');
});

function fresh() {
  return newState({
    installationId: 'demo-abc123',
    accountId: 'acc',
    inputs: { name: 'demo', hostname: null, workersDev: true, fromEmail: null },
    names: resourceNames('demo'),
    baseUrl: 'https://demo.workers.dev',
  });
}

describe('newState：新建状态', () => {
  it('填充默认值', () => {
    const s = fresh();
    expect(s).toMatchObject({
      schemaVersion: 1,
      status: 'planned',
      resources: [],
      steps: [],
      skipped: [],
      doNamespaceIds: {},
    });
    expect(s.ownershipNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh().ownershipNonce).not.toBe(s.ownershipNonce);
  });
});

describe('transition：状态转换', () => {
  const allowed: [Status, Status][] = [
    ['planned', 'provisioning'],
    ['provisioning', 'deploying'],
    ['deploying', 'verifying'],
    ['verifying', 'installed'],
    ['planned', 'failed'],
    ['provisioning', 'failed'],
    ['deploying', 'failed'],
    ['verifying', 'failed'],
    ['failed', 'provisioning'],
    ['failed', 'deploying'],
    ['failed', 'verifying'],
    ['installed', 'upgrading'],
    ['upgrading', 'installed'],
    ['upgrading', 'failed'],
    ['failed', 'upgrading'],
    ['deploying', 'provisioning'],
    ['provisioning', 'provisioning'],
    ['deploying', 'deploying'],
    ['verifying', 'verifying'],
  ];
  for (const [from, to] of allowed) {
    it(`状态转换：${from} -> ${to}`, () => {
      const s = { ...fresh(), status: from };
      expect(transition(s, to).status).toBe(to);
    });
  }
  it('状态相同时不作操作，原样返回状态', () => {
    const s = { ...fresh(), status: 'provisioning' as const };
    expect(transition(s, 'provisioning')).toBe(s);
  });
  const denied: [Status, Status][] = [
    ['installed', 'provisioning'],
    ['installed', 'installed'],
    ['installed', 'failed'],
    ['planned', 'installed'],
    ['planned', 'deploying'],
    ['failed', 'installed'],
  ];
  for (const [from, to] of denied) {
    it(`状态转换 ${from} -> ${to} 抛出错误`, () => {
      const s = { ...fresh(), status: from };
      expect(() => transition(s, to)).toThrow(
        `Cannot move from ${from} to ${to}`
      );
    });
  }
});

describe('升级与接管状态', () => {
  it('已安装状态可以开始升级', () => {
    const s = { ...fresh(), status: 'installed' as const };
    expect(transition(s, 'upgrading').status).toBe('upgrading');
  });
  it('失败的升级可以恢复', () => {
    const s = { ...fresh(), status: 'failed' as const, upgradeTarget: '1.2.0' };
    expect(transition(s, 'upgrading').status).toBe('upgrading');
  });
  it('已安装状态不能进入预配状态', () => {
    const s = { ...fresh(), status: 'installed' as const };
    expect(() => transition(s, 'provisioning')).toThrow(
      'Cannot move from installed to provisioning'
    );
  });
  it('接管归属信息可以完整保存和读取', () => {
    const r = {
      key: 'd1',
      kind: 'd1',
      name: 'x',
      id: 'id1',
      ownership: 'adopted',
      state: 'ready',
    } as const;
    const s = {
      ...recordResource(fresh(), r),
      adoptedAt: '2026-10-21T00:00:00.000Z',
      movedTo: '/home/x/.cloudforge',
      upgradedAt: '2026-10-22T00:00:00.000Z',
      upgradeTarget: '1.2.0',
    };
    const back = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(back.resources[0].ownership).toBe('adopted');
    expect(back).toEqual(s);
  });
});

describe('步骤和资源', () => {
  it('recordStep 具有幂等性', () => {
    const a = recordStep(fresh(), 'k');
    const b = recordStep(a, 'k');
    expect(hasStep(a, 'k')).toBe(true);
    expect(hasStep(a, 'other')).toBe(false);
    expect(b.steps).toHaveLength(1);
    expect(Date.parse(a.steps[0].at)).not.toBeNaN();
  });
  it('recordResource 拒绝将同一 ID 记录到另一个键下', () => {
    const r = {
      kind: 'd1',
      name: 'x',
      id: 'id1',
      ownership: 'created',
      state: 'ready',
    } as const;
    const s = recordResource(fresh(), { key: 'a', ...r });
    expect(() => recordResource(s, { key: 'b', ...r })).toThrow();
    expect(recordResource(s, { key: 'a', ...r }).resources).toHaveLength(1);
  });
});

describe('文件', () => {
  it('以 0600 权限完整保存和读取，且不遗留临时文件', () => {
    const s = fresh();
    writeState(dir, s);
    expect(readState(dir, s.installationId)).toEqual(s);
    expect(statSync(statePath(dir, s.installationId)).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([`${s.installationId}.json`]);
    expect(listStates(dir)).toEqual([s]);
  });
  it('缺失状态读取为 null，缺失目录列出空结果', () => {
    expect(readState(dir, 'nope')).toBeNull();
    expect(listStates(dir)).toEqual([]);
  });
});

describe('锁', () => {
  it('第二次获取锁时抛出错误，释放时删除文件', () => {
    const release = acquireLock(dir, 'id', { pidAlive: () => true });
    expect(() => acquireLock(dir, 'id', { pidAlive: () => true })).toThrow(
      `Another cloudforge run is using this installation (pid ${process.pid} on ${hostname()}).`
    );
    release();
    expect(existsSync(join(dir, 'id.lock'))).toBe(false);
    acquireLock(dir, 'id', { pidAlive: () => true })();
  });
  it('回收已终止进程的过期锁', () => {
    makeDir();
    writeFileSync(
      join(dir, 'id.lock'),
      JSON.stringify({ pid: 999999, host: hostname(), startedAt: 'x' })
    );
    const release = acquireLock(dir, 'id', { pidAlive: () => false });
    release();
    expect(existsSync(join(dir, 'id.lock'))).toBe(false);
  });
  it('空的部分写入锁视为已持有，既不判为过期也不修改', () => {
    makeDir();
    writeFileSync(join(dir, 'id.lock'), '');
    expect(() => acquireLock(dir, 'id', { pidAlive: () => false })).toThrow(
      /Another cloudforge run/
    );
    expect(readFileSync(join(dir, 'id.lock'), 'utf8')).toBe('');
  });
  it('释放操作不删除已归他人所有的锁', () => {
    const release = acquireLock(dir, 'id', { pidAlive: () => true });
    const other = JSON.stringify({ pid: 1, host: 'elsewhere', startedAt: 'y' });
    writeFileSync(join(dir, 'id.lock'), other);
    release();
    expect(readFileSync(join(dir, 'id.lock'), 'utf8')).toBe(other);
  });
  it('回收过期锁后不遗留文件', () => {
    makeDir();
    writeFileSync(
      join(dir, 'id.lock'),
      JSON.stringify({ pid: 1, host: hostname(), startedAt: 'x' })
    );
    const release = acquireLock(dir, 'id', { pidAlive: () => false });
    expect(readdirSync(dir)).toEqual(['id.lock']);
    release();
  });
  it('状态文件损坏时指出路径', () => {
    makeDir();
    writeFileSync(join(dir, 'bad.json'), '{');
    expect(() => readState(dir, 'bad')).toThrow(
      /State file .*bad\.json is corrupt/
    );
    expect(() => listStates(dir)).toThrow(/is corrupt/);
  });
  it('从不回收来自其他主机的锁', () => {
    makeDir();
    writeFileSync(
      join(dir, 'id.lock'),
      JSON.stringify({ pid: 1, host: 'elsewhere', startedAt: 'x' })
    );
    expect(() => acquireLock(dir, 'id', { pidAlive: () => false })).toThrow(
      /pid 1 on elsewhere/
    );
  });
});

function makeDir() {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}
