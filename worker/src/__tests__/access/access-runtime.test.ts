// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  AccessRuntimeError,
  assertAccessRuntime,
  readAccessRuntime,
} from '../../access/runtime';
import { resetAccessRuntimeFixture } from '../helpers/access-runtime';

const db = env.ACCESS_RUNTIME_DB;
const run = (sql: string) => db.prepare(sql).run();
const generation = () =>
  db
    .prepare('SELECT generation FROM access_control_state WHERE id = 1')
    .first<number>('generation');
const ready = {
  protocol: 1,
  ready: true,
  minimumProtocol: 1,
  schemaMode: 'compat-v1',
  rolePublishingEnabled: false,
  revision: 0,
  reason: 'ready',
};

describe('运行时协议桥接与单调围栏（真实 D1）', () => {
  it('真实迁移保留默认角色关闭、协议 1 与永久 singleton', async () => {
    expect(await assertAccessRuntime(env.DB)).toEqual(ready);
  });

  it('每次重新读取状态，升高下限后拒绝并原子推进权限代数', async () => {
    await resetAccessRuntimeFixture();
    expect(await assertAccessRuntime(db)).toEqual(ready);
    await run(
      'UPDATE access_runtime_state SET minimum_protocol = 2, revision = 1 WHERE id = 1'
    );
    expect(await generation()).toBe(1);
    const blocked = {
      ...ready,
      ready: false,
      minimumProtocol: 2,
      revision: 1,
      reason: 'unsupported',
    };
    expect(await readAccessRuntime(db)).toEqual(blocked);
    const error = await assertAccessRuntime(db).catch((error) => error);
    expect(error).toBeInstanceOf(AccessRuntimeError);
    expect(error.status).toEqual(blocked);
    await expect(
      run('UPDATE access_runtime_state SET minimum_protocol = 1, revision = 2')
    ).rejects.toThrow('runtime transition invalid');
    expect(await readAccessRuntime(db)).toEqual(blocked);
    expect(await generation()).toBe(1);
  });

  it('同值下限更新也必须 revision 精确递增且只推进一次权限代数', async () => {
    await resetAccessRuntimeFixture();
    await expect(
      run('UPDATE access_runtime_state SET revision = 0')
    ).rejects.toThrow('runtime transition invalid');
    await expect(
      run('UPDATE access_runtime_state SET revision = 2')
    ).rejects.toThrow('runtime transition invalid');
    await run('UPDATE access_runtime_state SET revision = 1');
    expect(await generation()).toBe(1);
    expect(await readAccessRuntime(db)).toEqual({ ...ready, revision: 1 });
  });

  it('永久状态不能删除、重复插入或 REPLACE，且新角色仍不能发布', async () => {
    await resetAccessRuntimeFixture();
    for (const sql of [
      'DELETE FROM access_runtime_state',
      'INSERT INTO access_runtime_state (id) VALUES (1)',
      'INSERT OR REPLACE INTO access_runtime_state (id) VALUES (1)',
      "UPDATE access_runtime_state SET schema_mode = 'roles-v2', revision = 1",
      'UPDATE access_runtime_state SET role_publishing_enabled = 1, revision = 1',
      'UPDATE access_runtime_state SET id = 2, revision = 1',
      'UPDATE access_runtime_state SET minimum_protocol = 1.5, revision = 1',
      'UPDATE access_runtime_state SET minimum_protocol = 9007199254740992, revision = 1',
      'UPDATE access_runtime_state SET revision = 1.5',
    ])
      await expect(run(sql)).rejects.toThrow();
    expect(await readAccessRuntime(db)).toEqual(ready);
    expect(await generation()).toBe(0);
  });

  it('权限代数溢出会回滚整个下限更新', async () => {
    await resetAccessRuntimeFixture({ generation: Number.MAX_SAFE_INTEGER });
    await expect(
      run('UPDATE access_runtime_state SET minimum_protocol = 2, revision = 1')
    ).rejects.toThrow('access generation conflict');
    expect(await readAccessRuntime(db)).toEqual(ready);
    expect(await generation()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('迁移 bootstrap 只接受默认状态且不提前推进权限代数', async () => {
    await resetAccessRuntimeFixture({ seed: false, generation: 17 });
    for (const values of [
      "1, 2, 'compat-v1', 0, 0",
      "1, 1, 'compat-v1', 0, 1",
      "1, 1, 'compat-v1', 1, 0",
    ])
      await expect(
        run(`INSERT INTO access_runtime_state VALUES (${values})`)
      ).rejects.toThrow('runtime bootstrap invalid');
    await run('INSERT INTO access_runtime_state (id) VALUES (1)');
    expect(await generation()).toBe(17);
    expect(await readAccessRuntime(db)).toEqual(ready);
  });

  it('关闭 CHECK 的独立故障夹具仍由真实声明触发器拒绝非法状态', async () => {
    await resetAccessRuntimeFixture();
    await run('PRAGMA ignore_check_constraints = ON');
    try {
      for (const assignment of [
        'id = 2',
        'minimum_protocol = 0',
        'minimum_protocol = 1.5',
        "schema_mode = 'roles-v2'",
        'role_publishing_enabled = 1',
      ])
        await expect(
          run(`UPDATE access_runtime_state SET ${assignment}, revision = 1`)
        ).rejects.toThrow('runtime transition invalid');
      expect(await generation()).toBe(0);
      expect(await readAccessRuntime(db)).toEqual(ready);
    } finally {
      await run('PRAGMA ignore_check_constraints = OFF');
    }
  });

  it('缺失权限 state 时下限更新失败且不部分写入', async () => {
    await resetAccessRuntimeFixture();
    await run('DELETE FROM access_control_state');
    await expect(
      run('UPDATE access_runtime_state SET minimum_protocol = 2, revision = 1')
    ).rejects.toThrow('access state missing');
    expect(await readAccessRuntime(db)).toEqual(ready);
  });

  it('没有 seed、没有表或查询失败时不猜测默认状态', async () => {
    await resetAccessRuntimeFixture({ seed: false });
    expect(await readAccessRuntime(db)).toMatchObject({
      ready: false,
      reason: 'missing',
    });
    await run('DROP TABLE access_runtime_state');
    expect(await readAccessRuntime(db)).toMatchObject({
      ready: false,
      reason: 'unavailable',
    });
    await run('CREATE TABLE access_runtime_state (unexpected TEXT)');
    const error = await assertAccessRuntime(db).catch((error) => error);
    expect(error).toBeInstanceOf(AccessRuntimeError);
    expect(error.message).not.toMatch(/SELECT|unexpected|D1_ERROR|SQLITE/);
    expect(error.status.reason).toBe('unavailable');
  });

  it.each([
    'id = 2',
    'minimum_protocol = 0',
    'minimum_protocol = 1.5',
    'minimum_protocol = 9007199254740992',
    'minimum_protocol = NULL',
    "schema_mode = 'sensitive-untrusted-text'",
    'role_publishing_enabled = 1',
    'revision = -1',
    'revision = 9007199254740992',
    'revision = NULL',
  ])('不完整/异常状态拒绝且不回显原值：%s', async (assignment) => {
    await resetAccessRuntimeFixture({ guards: false, unchecked: true });
    await run(`UPDATE access_runtime_state SET ${assignment}`);
    expect(await readAccessRuntime(db)).toEqual({
      protocol: 1,
      ready: false,
      minimumProtocol: null,
      schemaMode: null,
      rolePublishingEnabled: null,
      revision: null,
      reason: 'invalid',
    });
  });

  it('有额外行时拒绝，不能只读取 id 1 隐藏损坏', async () => {
    await resetAccessRuntimeFixture({ guards: false, unchecked: true });
    await run(
      "INSERT INTO access_runtime_state VALUES (2, 1, 'compat-v1', 0, 0)"
    );
    expect(await readAccessRuntime(db)).toMatchObject({
      ready: false,
      reason: 'invalid',
    });
  });
});
