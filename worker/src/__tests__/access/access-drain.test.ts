// CloudForge fork addition (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  accessDrainQuery,
  analyzeAccessDrainSnapshot,
} from '../../../../scripts/cloudforge/access/access-drain-data';
import { accessPreflightDiscoveryQuery } from '../../../../scripts/cloudforge/access/access-preflight-data';
import type { AccessInstallation } from '../../../../scripts/cloudforge/access/access-preflight-data';

const db = env.DB;
const collectionNames = [
  'workflowRuns',
  'workflowJobs',
  'runnerSessions',
  'agentRuns',
  'agentSteps',
  'pushEvents',
] as const;
type Collection = (typeof collectionNames)[number];

async function raw(
  installation?: AccessInstallation,
  database: D1Database = db
) {
  const query = accessDrainQuery(installation);
  const row = await database
    .prepare(query.sql)
    .bind(...query.params)
    .first<{ accessSnapshot: string; drainSnapshot: string }>();
  if (!row) throw new Error('Missing drain snapshot fixture.');
  return row;
}

async function observe(
  installation?: AccessInstallation,
  database: D1Database = db
) {
  const row = await raw(installation, database);
  return analyzeAccessDrainSnapshot(row.accessSnapshot, row.drainSnapshot);
}

/** A refusal must come from a successfully executed bounded snapshot. */
async function rejected(
  installation?: AccessInstallation,
  database: D1Database = db
) {
  const row = await raw(installation, database);
  expect(() =>
    analyzeAccessDrainSnapshot(row.accessSnapshot, row.drainSnapshot)
  ).toThrow();
}

async function seedBase() {
  await db.batch([
    db.prepare(
      "INSERT INTO users(id,name,email,username,role) VALUES('owner','Owner','private-address@example.invalid','owner','admin')"
    ),
    db.prepare(
      "INSERT INTO repositories(id,owner_id,name,artifacts_name,created_at,updated_at) VALUES('repo','owner','private-repository-name','r_repo',0,0)"
    ),
  ]);
}

/** Bulk fixtures stay below the D1 binding limit and preserve all production guards. */
async function seedCollection(
  collection: Collection,
  count = 1,
  status?: string
) {
  const rows = JSON.stringify(Array.from({ length: count }, (_, i) => i));
  const queries: Record<Collection, string> = {
    workflowRuns: `INSERT INTO workflow_runs(id,repository_id,run_number,workflow_path,name,event,ref,head_sha,display_title,status,created_at)
      SELECT 'run-'||value,'repo',value+1,'private-workflow.yml','private-workflow-name','push','refs/heads/private', 'private-head-sha','private-display-title',?,10 FROM json_each(?)`,
    workflowJobs: `INSERT INTO workflow_jobs(id,run_id,job_key,name,runs_on,needs,status,started_at)
      SELECT 'job-'||value,'run-0','private-job-key','private-job-name','private-runner-image','[]',?,11 FROM json_each(?)`,
    runnerSessions: `INSERT INTO runner_sessions(id,job_id,repository_id,instance_type,started_at,deadline_at)
      SELECT 'session-'||value,'job-0','repo','private-instance-type',12,13 FROM json_each(?)`,
    agentRuns: `INSERT INTO agent_runs(id,repository_id,kind,status,title,workflow_instance_id,started_at,error)
      SELECT 'agent-run-'||value,'repo','review',?,'private-agent-title','private-workflow-instance',14,'private-run-error' FROM json_each(?)`,
    agentSteps: `INSERT INTO agent_steps(id,run_id,position,name,status,started_at,model,decision,error)
      SELECT 'agent-step-'||value,'agent-run-0',value,'private-step-name',?,15,'private-model','private-decision','private-step-error' FROM json_each(?)`,
    pushEvents: `INSERT INTO push_events(id,repository_id,commands,created_at,claimed_at)
      SELECT 'push-'||value,'repo','[{"ref":"refs/heads/private-ref","old":"private-old","new":"private-new"}]',16,17 FROM json_each(?)`,
  };
  if (collection === 'runnerSessions' || collection === 'pushEvents')
    await db.prepare(queries[collection]).bind(rows).run();
  else
    await db
      .prepare(queries[collection])
      .bind(
        status ?? (collection.startsWith('agent') ? 'running' : 'queued'),
        rows
      )
      .run();
}

async function seedParents(collection: Collection) {
  await seedBase();
  if (collection === 'workflowJobs' || collection === 'runnerSessions')
    await seedCollection('workflowRuns', 1, 'completed');
  if (collection === 'runnerSessions')
    await seedCollection('workflowJobs', 1, 'completed');
  if (collection === 'agentSteps')
    await seedCollection('agentRuns', 1, 'succeeded');
  await db.batch([
    db.prepare(
      "UPDATE workflow_runs SET completed_at=10 WHERE status='completed'"
    ),
    db.prepare(
      "UPDATE workflow_jobs SET completed_at=11 WHERE status='completed'"
    ),
    db.prepare("UPDATE agent_runs SET finished_at=14 WHERE status='succeeded'"),
  ]);
}

async function databaseHash() {
  const definitions = await db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name"
    )
    .all<{
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    }>();
  const tables = definitions.results.filter(({ type }) => type === 'table');
  const contents = await db.batch(
    tables.map(({ name }) =>
      db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
    )
  );
  const stable = JSON.stringify({
    definitions: definitions.results,
    tables: contents.map((result, i) => ({
      name: tables[i].name,
      rows: result.results.map((row) => JSON.stringify(row)).sort(),
    })),
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stable)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

describe('只读排空观测（真实 D1）', () => {
  it('空观测也不声称全局排空、准入暂停、角色可发布或回滚安全', async () => {
    const result = await observe();
    expect(result).toMatchObject({
      workObserved: false,
      observationsOnly: true,
      workflowJobCapacityReservations: 0,
      drainComplete: false,
      rolePublishingAllowed: false,
      rollbackSafe: false,
      admissionPaused: false,
    });
    for (const name of collectionNames) {
      expect(result.categories[name]).toMatchObject({ count: 0, samples: [] });
      expect(
        Object.values(result.categories[name].states).every(
          (count) => count === 0
        )
      ).toBe(true);
    }
  });

  it('六类独立记录与容量计数准确，时间统一为毫秒', async () => {
    await seedBase();
    for (const name of collectionNames)
      await seedCollection(
        name,
        1,
        name === 'workflowJobs' ? 'in_progress' : undefined
      );
    const result = await observe();
    expect(result).toMatchObject({
      schemaVersion: 'runtime-bridge-v1',
      runtime: {
        minimumProtocol: 1,
        schemaMode: 'compat-v1',
        rolePublishingEnabled: false,
      },
      workObserved: true,
      observationsOnly: true,
      workflowJobCapacityReservations: 1,
      drainComplete: false,
      rolePublishingAllowed: false,
      rollbackSafe: false,
      admissionPaused: false,
      categories: {
        workflowRuns: {
          count: 1,
          states: { queued: 1 },
          samples: [
            {
              id: 'run-0',
              state: 'queued',
              repositoryId: 'repo',
              createdAt: 10_000,
            },
          ],
        },
        workflowJobs: {
          count: 1,
          states: { in_progress: 1 },
          samples: [
            {
              id: 'job-0',
              state: 'in_progress',
              runId: 'run-0',
              startedAt: 11_000,
            },
          ],
        },
        runnerSessions: {
          count: 1,
          states: { open: 1 },
          samples: [
            {
              id: 'session-0',
              state: 'open',
              jobId: 'job-0',
              repositoryId: 'repo',
              startedAt: 12,
              deadlineAt: 13,
            },
          ],
        },
        agentRuns: {
          count: 1,
          states: { running: 1 },
          samples: [
            {
              id: 'agent-run-0',
              state: 'running',
              repositoryId: 'repo',
              startedAt: 14,
            },
          ],
        },
        agentSteps: {
          count: 1,
          states: { running: 1 },
          samples: [
            {
              id: 'agent-step-0',
              state: 'running',
              runId: 'agent-run-0',
              startedAt: 15,
            },
          ],
        },
        pushEvents: {
          count: 1,
          states: { pending: 1 },
          samples: [
            {
              id: 'push-0',
              state: 'pending',
              repositoryId: 'repo',
              createdAt: 16,
              claimedAt: 17,
              attempts: 0,
            },
          ],
        },
      },
    });
    expect(Number.isSafeInteger(result.observedAt)).toBe(true);
    expect(result.observedAt).toBeGreaterThan(0);
    expect(result.accessGeneration).toBe(
      await db
        .prepare('SELECT generation FROM access_control_state WHERE id=1')
        .first('generation')
    );
  });

  it('已结束 run 下的活动 job 独立计入容量', async () => {
    await seedParents('workflowJobs');
    await seedCollection('workflowJobs', 1, 'in_progress');
    const result = await observe();
    expect(result.categories.workflowRuns.count).toBe(0);
    expect(result.categories.workflowJobs).toMatchObject({
      count: 1,
      states: { in_progress: 1 },
      samples: [{ id: 'job-0', runId: 'run-0' }],
    });
    expect(result.workflowJobCapacityReservations).toBe(1);
  });

  it('过期未关闭 runner 与真实父删除后的孤儿都保留观测', async () => {
    await seedParents('runnerSessions');
    await seedCollection('runnerSessions');
    const expired = await observe();
    expect(expired.categories.workflowRuns.count).toBe(0);
    expect(expired.categories.workflowJobs.count).toBe(0);
    expect(expired.categories.runnerSessions).toMatchObject({
      count: 1,
      samples: [{ id: 'session-0', state: 'open', deadlineAt: 13 }],
    });
    await db.prepare("DELETE FROM repositories WHERE id='repo'").run();
    const orphan = await observe();
    expect(orphan.categories.runnerSessions).toMatchObject({
      count: 1,
      samples: [
        { id: 'session-0', state: 'open', repositoryId: null, jobId: null },
      ],
    });
    expect(orphan.workObserved).toBe(true);
    expect(orphan.drainComplete).toBe(false);
  });

  it('已结束 agent run 下的未结束 step 独立保留', async () => {
    await seedParents('agentSteps');
    await seedCollection('agentSteps');
    const result = await observe();
    expect(result.categories.agentRuns.count).toBe(0);
    expect(result.categories.agentSteps).toMatchObject({
      count: 1,
      samples: [{ id: 'agent-step-0', state: 'running', runId: 'agent-run-0' }],
    });
  });

  it('无完成收据的 push 不因重试耗尽或记录很旧而消失', async () => {
    await seedParents('pushEvents');
    await seedCollection('pushEvents');
    await db.prepare('UPDATE push_events SET attempts=1000,created_at=0').run();
    expect((await observe()).categories.pushEvents).toMatchObject({
      count: 1,
      samples: [
        { id: 'push-0', state: 'pending', attempts: 1000, createdAt: 0 },
      ],
    });
  });

  it('六类终态且有完成时间的记录不计入声明的候选集合', async () => {
    await seedBase();
    for (const name of collectionNames) await seedCollection(name);
    await db.batch([
      db.prepare("UPDATE workflow_runs SET status='completed',completed_at=20"),
      db.prepare("UPDATE workflow_jobs SET status='completed',completed_at=20"),
      db.prepare('UPDATE runner_sessions SET stopped_at=20'),
      db.prepare("UPDATE agent_runs SET status='succeeded',finished_at=20"),
      db.prepare("UPDATE agent_steps SET status='failed',finished_at=20"),
      db.prepare('UPDATE push_events SET completed_at=20'),
    ]);
    const result = await observe();
    for (const name of collectionNames)
      expect(result.categories[name].count).toBe(0);
    expect(result.workObserved).toBe(false);
    expect(result.drainComplete).toBe(false);
  });

  it.each(collectionNames)(
    '%s 恰好 1000 行可观察且样本最多 20 条',
    async (name) => {
      await seedParents(name);
      await seedCollection(name, 1000);
      const result = await observe();
      expect(result.categories[name].count).toBe(1000);
      expect(result.categories[name].samples).toHaveLength(20);
      expect(result.workObserved).toBe(true);
      expect((await observe()).categories[name]).toEqual(
        result.categories[name]
      );
    }
  );

  it.each(collectionNames)('%s 超过 1000 行时拒绝截断前缀', async (name) => {
    await seedParents(name);
    await seedCollection(name, 1001);
    await rejected();
  });

  it.each(['workflowRuns', 'workflowJobs', 'agentRuns', 'agentSteps'] as const)(
    '%s 未知状态不被过滤成空观测',
    async (name) => {
      await seedParents(name);
      await seedCollection(name, 1, 'future-state');
      await rejected();
    }
  );

  it.each([
    ['workflowRuns', 'workflow_runs', 'completed_at', ['completed'], 'queued'],
    [
      'workflowJobs',
      'workflow_jobs',
      'completed_at',
      ['completed'],
      'in_progress',
    ],
    [
      'agentRuns',
      'agent_runs',
      'finished_at',
      ['succeeded', 'failed'],
      'running',
    ],
    [
      'agentSteps',
      'agent_steps',
      'finished_at',
      ['succeeded', 'failed'],
      'running',
    ],
  ] as const)(
    '%s 状态与完成时间遵循该记录的重试契约',
    async (name, table, completed, terminalStates, active) => {
      await seedParents(name);
      await seedCollection(name);
      for (const terminal of terminalStates) {
        await db
          .prepare(`UPDATE ${table} SET status=?,${completed}=NULL`)
          .bind(terminal)
          .run();
        await rejected();
        await db.prepare(`UPDATE ${table} SET ${completed}=20`).run();
        expect((await observe()).categories[name].count).toBe(0);
      }
      await db.prepare(`UPDATE ${table} SET status=?`).bind(active).run();
      if (name === 'agentSteps')
        expect((await observe()).categories.agentSteps.count).toBe(1);
      else await rejected();
      await db.prepare(`UPDATE ${table} SET ${completed}=NULL`).run();
      expect((await observe()).categories[name].count).toBe(1);
    }
  );

  it('agent step 重试保留的历史完成时间不隐藏当前 running 记录', async () => {
    await seedParents('agentSteps');
    await seedCollection('agentSteps');
    // recordingSteps() increments attempts and clears error/decision on retry,
    // but intentionally retains the previous attempt's finishedAt value.
    await db
      .prepare(
        "UPDATE agent_steps SET status='running',attempts=2,finished_at=20,error=NULL,decision=NULL"
      )
      .run();
    expect((await observe()).categories.agentSteps).toMatchObject({
      count: 1,
      states: { running: 1 },
      samples: [
        {
          id: 'agent-step-0',
          state: 'running',
          attempts: 2,
          startedAt: 15,
          finishedAt: 20,
        },
      ],
    });
  });

  it.each([
    ['agentRuns', 'agent_runs'],
    ['agentSteps', 'agent_steps'],
  ] as const)('%s 恢复开放标记不能作为普通终态排除', async (name, table) => {
    await seedParents(name);
    await seedCollection(name, 1, 'failed');
    await db.prepare(`UPDATE ${table} SET finished_at=20`).run();
    expect((await observe()).categories[name].count).toBe(0);
    await db.prepare(`UPDATE ${table} SET error='Did not finish'`).run();
    await rejected();
  });

  it.each(['status', 'id'] as const)(
    '样本20条之外的非法 %s 仍拒绝',
    async (kind) => {
      await seedParents('workflowRuns');
      await seedCollection('workflowRuns', 25);
      await db
        .prepare("UPDATE workflow_runs SET id=?,status=? WHERE id='run-24'")
        .bind(
          kind === 'id' ? 'zz\u200b0' : 'zz-future',
          kind === 'status' ? 'future-state' : 'queued'
        )
        .run();
      const snapshot = await raw();
      const candidates = JSON.parse(snapshot.drainSnapshot).categories
        .workflowRuns;
      expect(candidates.samples).toHaveLength(20);
      expect(candidates.invalid).toBe(1);
      expect(() =>
        analyzeAccessDrainSnapshot(
          snapshot.accessSnapshot,
          snapshot.drainSnapshot
        )
      ).toThrow();
    }
  );

  it.each([
    ['id', "'bad'||char(10)||'id'"],
    ['id', "'bad'||char(8203)||'id'"],
    ['id', "'x'||printf('%01024d',0)"],
    ['id', "x'626164'"],
    ['started_at', "'not-a-time'"],
    ['started_at', '-1'],
    ['started_at', '1.5'],
    ['started_at', '9007199254740992'],
  ])('非法 runner 字段 %s=%s 拒绝', async (column, expression) => {
    await seedParents('runnerSessions');
    await seedCollection('runnerSessions');
    await db
      .prepare(`UPDATE runner_sessions SET ${column}=${expression}`)
      .run();
    await rejected();
  });

  it('合法 Unicode、空格和斜线 ID 保留原值', async () => {
    await seedParents('runnerSessions');
    await seedCollection('runnerSessions');
    await db
      .prepare('UPDATE runner_sessions SET id=?')
      .bind('执行 / 会话 0')
      .run();
    expect((await observe()).categories.runnerSessions.samples[0].id).toBe(
      '执行 / 会话 0'
    );
  });

  it('秒转毫秒溢出拒绝而不返回不安全整数', async () => {
    await seedParents('workflowRuns');
    await seedCollection('workflowRuns');
    await db
      .prepare('UPDATE workflow_runs SET created_at=9007199254740991')
      .run();
    await rejected();
  });

  it('六类大候选集合只聚合有界样本，输出字节超限仍拒绝', async () => {
    await seedBase();
    for (const name of collectionNames) await seedCollection(name, 1000);
    // Every ID is 500 ASCII bytes (within the declared 512-byte bound). Each
    // category contributes only its 20 samples to the output, so SQL must not
    // construct a combined JSON value from all 6000 candidate records.
    await db.batch([
      db.prepare('PRAGMA defer_foreign_keys=on'),
      db.prepare(
        "UPDATE workflow_runs SET id='r'||printf('%0499d',CAST(substr(id,5) AS INTEGER))"
      ),
      db.prepare(
        "UPDATE workflow_jobs SET id='j'||printf('%0499d',CAST(substr(id,5) AS INTEGER)),run_id='r'||printf('%0499d',CAST(substr(run_id,5) AS INTEGER))"
      ),
      db.prepare(
        "UPDATE runner_sessions SET id='s'||printf('%0499d',CAST(substr(id,9) AS INTEGER)),job_id='j'||printf('%0499d',CAST(substr(job_id,5) AS INTEGER))"
      ),
      db.prepare(
        "UPDATE agent_runs SET id='a'||printf('%0499d',CAST(substr(id,11) AS INTEGER))"
      ),
      db.prepare(
        "UPDATE agent_steps SET id='t'||printf('%0499d',CAST(substr(id,12) AS INTEGER)),run_id='a'||printf('%0499d',CAST(substr(run_id,11) AS INTEGER))"
      ),
      db.prepare(
        "UPDATE push_events SET id='p'||printf('%0499d',CAST(substr(id,6) AS INTEGER))"
      ),
    ]);
    const snapshot = await raw();
    expect(
      new TextEncoder().encode(snapshot.accessSnapshot).length +
        new TextEncoder().encode(snapshot.drainSnapshot).length
    ).toBeLessThan(2_000_000);
    const result = analyzeAccessDrainSnapshot(
      snapshot.accessSnapshot,
      snapshot.drainSnapshot
    );
    for (const name of collectionNames) {
      expect(result.categories[name].count).toBe(1000);
      expect(result.categories[name].samples).toHaveLength(20);
    }
    expect(() =>
      analyzeAccessDrainSnapshot(
        snapshot.accessSnapshot,
        snapshot.drainSnapshot.padEnd(1_800_001, ' ')
      )
    ).toThrow();
  });

  it.each(['TEXT', "TEXT GENERATED ALWAYS AS ('future') VIRTUAL"])(
    '发现后新增 %s 列由最终同句快照拒绝',
    async (type) => {
      await db.prepare(accessPreflightDiscoveryQuery().sql).first();
      await db.exec(
        `ALTER TABLE runner_sessions ADD COLUMN future_state ${type}`
      );
      try {
        await rejected();
      } finally {
        await db.exec('ALTER TABLE runner_sessions DROP COLUMN future_state');
      }
    }
  );

  it('缺表拒绝且不把不可观测解释为零', async () => {
    await db.exec(
      'ALTER TABLE runner_sessions RENAME TO fixture_runner_sessions'
    );
    try {
      await expect(observe()).rejects.toThrow('no such table');
    } finally {
      await db.exec(
        'ALTER TABLE fixture_runner_sessions RENAME TO runner_sessions'
      );
    }
  });

  it('同名 view 不能代替真实观测表', async () => {
    await db.exec(
      'ALTER TABLE runner_sessions RENAME TO fixture_runner_sessions'
    );
    try {
      await db.exec(
        'CREATE VIEW runner_sessions AS SELECT * FROM fixture_runner_sessions'
      );
      try {
        await rejected();
      } finally {
        await db.exec('DROP VIEW runner_sessions');
      }
    } finally {
      await db.exec(
        'ALTER TABLE fixture_runner_sessions RENAME TO runner_sessions'
      );
    }
  });

  it('marker 在发现后更换由最终同句快照拒绝，不回显 nonce', async () => {
    const installation = {
      id: 'installation',
      ownershipNonce: 'private-ownership-nonce',
    };
    await db
      .prepare(
        'INSERT INTO install_state(installation_id,ownership_nonce,version,manifest_json,updated_at) VALUES(?,?,?, ?,0)'
      )
      .bind(installation.id, installation.ownershipNonce, '1.0.0', '{}')
      .run();
    await observe(installation);
    await db
      .prepare("UPDATE install_state SET ownership_nonce='changed-nonce'")
      .run();
    const changed = await raw(installation);
    let error: unknown;
    try {
      analyzeAccessDrainSnapshot(changed.accessSnapshot, changed.drainSnapshot);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(
      /private-ownership|changed-nonce/
    );
  });

  it('合法提高协议下限后最终同句快照拒绝，保持永久 guard', async () => {
    const isolated = env.ACCESS_ACTIONS_RUNTIME_DB;
    await applyD1Migrations(isolated, env.TEST_D1_MIGRATIONS);
    await isolated.prepare(accessPreflightDiscoveryQuery().sql).first();
    await isolated
      .prepare(
        'UPDATE access_runtime_state SET minimum_protocol=minimum_protocol+1,revision=revision+1 WHERE id=1'
      )
      .run();
    await rejected(undefined, isolated);
    await expect(
      isolated.prepare('DELETE FROM access_runtime_state').run()
    ).rejects.toThrow('cannot be deleted');
  });

  it('只读观测前后完整 schema 与业务记录 SHA-256 一致且不返回内容字段', async () => {
    await seedBase();
    for (const name of collectionNames) await seedCollection(name);
    const before = await databaseHash();
    const result = await observe();
    expect(await databaseHash()).toBe(before);
    expect(result).toMatchObject({
      drainComplete: false,
      rolePublishingAllowed: false,
      rollbackSafe: false,
      admissionPaused: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-(address|repository-name|workflow|display|head|job|runner|instance|agent|run-error|step|model|decision|ref|old|new)/
    );
  });

  it('真实快照的状态计数与完成字段被改写后拒绝解析', async () => {
    await seedBase();
    for (const name of collectionNames) await seedCollection(name);
    const snapshot = await raw();
    const original = JSON.parse(snapshot.drainSnapshot);
    const wrongCount = structuredClone(original);
    wrongCount.categories.workflowRuns.states.queued = 2;
    expect(() =>
      analyzeAccessDrainSnapshot(
        snapshot.accessSnapshot,
        JSON.stringify(wrongCount)
      )
    ).toThrow();
    for (const [name, field] of [
      ['workflowRuns', 'completedAt'],
      ['workflowJobs', 'completedAt'],
      ['runnerSessions', 'stoppedAt'],
      ['agentRuns', 'finishedAt'],
      ['pushEvents', 'completedAt'],
    ]) {
      const changed = structuredClone(original);
      changed.categories[name].samples[0][field] = 20;
      expect(() =>
        analyzeAccessDrainSnapshot(
          snapshot.accessSnapshot,
          JSON.stringify(changed)
        )
      ).toThrow();
    }
  });
});
