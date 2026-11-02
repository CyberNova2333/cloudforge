// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { executeRun, type StepRunner } from '../../actions/executor';
import { schema } from '../../db/schema';
import { ACCESS_RUNTIME_TRIGGERS } from '../../db/access-runtime-triggers';
import { ACCESS_RUNTIME_BACKFILLS } from '../../db/access-runtime-backfill';
import { makeEnv } from '../helpers/app';
import { FakeRepo } from '../helpers/fake-artifacts';
import { commitPaths } from '../helpers/seed';

const DB = env.ACCESS_ACTIONS_RUNTIME_DB;
await applyD1Migrations(DB, env.TEST_D1_MIGRATIONS);
const runtimeTable = env.TEST_D1_MIGRATIONS.flatMap(
  (migration) => migration.queries
).find((query) => query.startsWith('CREATE TABLE `access_runtime_state`'))!;
const tables = (
  await DB.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'"
  ).all<{ name: string }>()
).results.map(({ name }) => name);

beforeEach(async () => {
  // Only this dedicated fixture is rebuilt. The app's permanent state/guards stay intact.
  const cleanup = [
    'repositories',
    ...tables.filter(
      (name) =>
        ![
          'repositories',
          'access_control_state',
          'access_runtime_state',
        ].includes(name)
    ),
  ];
  await DB.batch([
    DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...cleanup.map((name) => DB.prepare(`DELETE FROM "${name}"`)),
    DB.prepare('DROP TABLE access_runtime_state'),
    DB.prepare(runtimeTable),
    ...ACCESS_RUNTIME_TRIGGERS.map(({ sql }) => DB.prepare(sql)),
    ...ACCESS_RUNTIME_BACKFILLS.flatMap(({ statements }) =>
      statements.map((sql) => DB.prepare(sql))
    ),
  ]);
});

const fence = () =>
  DB.prepare(
    'UPDATE access_runtime_state SET minimum_protocol = 2, revision = revision + 1 WHERE id = 1'
  ).run();
const rejected = (work: Promise<unknown>) =>
  expect(work).rejects.toMatchObject({
    name: 'AccessRuntimeError',
    status: { reason: 'unsupported' },
  });

async function fixture({ queue = true } = {}) {
  const t = makeEnv();
  const acquire = vi.fn(async () => ({ granted: true, ahead: 0 }));
  t.env = {
    ...t.env,
    DB,
    ACTIONS_QUEUE: queue
      ? {
          getByName: () => ({
            acquire,
            started: async () => {},
            release: async () => [],
            cancelRun: async () => [],
            positions: async () => ({}),
            reclaim: async () => ({ reclaimed: [], grants: [] }),
          }),
        }
      : undefined,
  } as unknown as CloudflareBindings;
  const repo = new FakeRepo('runtime-actions-repo');
  t.fake.repos.set(repo.name, repo);
  const sha = await commitPaths(
    repo,
    'main',
    {
      '.github/workflows/ci.yml':
        'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo test\n',
    },
    'Runtime fixture'
  );
  await DB.batch([
    DB.prepare(
      "INSERT INTO users (id,name,email,username) VALUES ('owner','Owner','owner@example.com','owner')"
    ),
    DB.prepare(
      "INSERT INTO repositories (id,owner_id,name,artifacts_name,created_at,updated_at) VALUES ('repo','owner','app',?,0,0)"
    ).bind(repo.name),
    DB.prepare(
      "INSERT INTO workflow_runs (id,repository_id,run_number,workflow_path,name,event,ref,head_sha,display_title,created_at) VALUES ('run','repo',1,'.github/workflows/ci.yml','CI','push','refs/heads/main',?,'CI',0)"
    ).bind(sha),
    DB.prepare(
      "INSERT INTO workflow_jobs (id,run_id,job_key,name,runs_on,needs) VALUES ('job','run','test','test','ubuntu-latest','[]')"
    ),
  ]);
  const stepNames: string[] = [];
  const beforeStep = vi.fn(
    async (_name: string): Promise<unknown | undefined> => undefined
  );
  const afterStep = vi.fn(async (_name: string, _value: unknown) => {});
  const waitForEvent = vi.fn(async () => {
    throw new Error('timed out');
  });
  const step = {
    do: async (name: string, a: unknown, b?: unknown) => {
      stepNames.push(name);
      const cached = await beforeStep(name);
      if (cached !== undefined) return cached;
      const value = await ((b ?? a) as () => Promise<unknown>)();
      await afterStep(name, value);
      return value;
    },
    waitForEvent,
  } as unknown as StepRunner;
  const boot = vi.fn(async () => ({ ms: 0 }));
  const run = () =>
    executeRun(
      {
        env: t.env,
        db: drizzle(DB, { schema }),
        step,
        runner: () =>
          ({
            boot,
            runStep: async () => ({
              exitCode: 0,
              timedOut: false,
              log: 'ran',
              outputs: {},
              envAdds: {},
              pathAdds: [],
              stateAdds: {},
            }),
            destroy: async () => {},
            live: async () => null,
          }) as never,
      },
      'run'
    );
  const status = () =>
    DB.prepare(
      'SELECT j.status AS jobStatus, r.status AS runStatus, r.conclusion, r.completed_at AS completedAt FROM workflow_jobs j JOIN workflow_runs r ON r.id=j.run_id WHERE j.id=?'
    )
      .bind('job')
      .first();
  return {
    acquire,
    boot,
    stepNames,
    beforeStep,
    afterStep,
    waitForEvent,
    run,
    status,
  };
}

describe('Actions runtime admission across queue failure and replay', () => {
  it('direct executor calls reject before loading even cached workflow state', async () => {
    const f = await fixture();
    await fence();
    await rejected(f.run());
    expect(f.stepNames).toEqual([]);
    expect(await f.status()).toMatchObject({
      jobStatus: 'queued',
      runStatus: 'queued',
    });
    expect(f.boot).not.toHaveBeenCalled();
  });

  it('queue RPC rejection after a floor change cannot enter the D1 outage fallback', async () => {
    const f = await fixture();
    f.acquire.mockImplementationOnce(async () => {
      await fence();
      // RPC errors need not preserve the worker's Error subclass.
      throw new Error('remote queue rejected the call');
    });
    await rejected(f.run());
    expect(f.acquire).toHaveBeenCalledOnce();
    expect(
      f.stepNames.some((name) =>
        /:capacity|:queue-down|:setup|finish-run/.test(name)
      )
    ).toBe(false);
    expect(await f.status()).toMatchObject({
      jobStatus: 'queued',
      runStatus: 'in_progress',
      conclusion: null,
      completedAt: null,
    });
    expect(f.boot).not.toHaveBeenCalled();
  });

  it('a queue grant cannot reserve capacity after the database fences this runtime', async () => {
    const f = await fixture();
    f.acquire.mockImplementationOnce(async () => {
      await fence();
      return { granted: true, ahead: 0 };
    });
    await rejected(f.run());
    expect(f.stepNames.some((name) => /:capacity|:setup/.test(name))).toBe(
      false
    );
    expect(await f.status()).toMatchObject({
      jobStatus: 'queued',
      conclusion: null,
    });
    expect(f.boot).not.toHaveBeenCalled();
  });

  it('the queue-less path rechecks after loading an admitted workflow', async () => {
    const f = await fixture({ queue: false });
    f.afterStep.mockImplementationOnce(async () => {
      await fence();
    });
    await rejected(f.run());
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.stepNames.some((name) => name.endsWith(':setup'))).toBe(false);
    expect(f.boot).not.toHaveBeenCalled();
  });

  it.each(['cached', 'executed'] as const)(
    '%s capacity grants recheck before boot; existing reservations remain held',
    async (kind) => {
      const f = await fixture();
      if (kind === 'cached')
        f.beforeStep.mockImplementation(async (name) => {
          if (!name.endsWith(':capacity:1')) return undefined;
          await fence();
          return { cancelled: false, start: true };
        });
      else
        f.afterStep.mockImplementation(async (name) => {
          if (name.endsWith(':capacity:1')) await fence();
        });
      await rejected(f.run());
      expect(await f.status()).toMatchObject({
        jobStatus: kind === 'cached' ? 'queued' : 'in_progress',
        conclusion: null,
        completedAt: null,
      });
      expect(f.stepNames.some((name) => /:setup|finish-run/.test(name))).toBe(
        false
      );
      expect(f.boot).not.toHaveBeenCalled();
    }
  );

  it('a resumed capacity wait rechecks outside the durable step before another reservation attempt', async () => {
    const f = await fixture();
    await DB.batch([
      DB.prepare(
        "INSERT INTO instance_settings(key,value,updated_at) VALUES ('actions.max_concurrent_jobs','1',0)"
      ),
      DB.prepare(
        "INSERT INTO workflow_runs(id,repository_id,run_number,workflow_path,name,event,ref,head_sha,display_title,created_at,status) SELECT 'busy-run',repository_id,2,workflow_path,name,event,ref,head_sha,display_title,0,'in_progress' FROM workflow_runs WHERE id='run'"
      ),
      DB.prepare(
        "INSERT INTO workflow_jobs(id,run_id,job_key,name,runs_on,needs,status) VALUES ('busy','busy-run','test','test','ubuntu-latest','[]','in_progress')"
      ),
    ]);
    f.acquire.mockRejectedValue(new Error('queue unavailable'));
    f.waitForEvent.mockImplementationOnce(async () => {
      await fence();
      throw new Error('timed out');
    });
    await rejected(f.run());
    expect(f.stepNames.filter((name) => name.includes(':queue-down:'))).toEqual(
      ['job:job:queue-down:1']
    );
    expect(await f.status()).toMatchObject({
      jobStatus: 'queued',
      conclusion: null,
    });
    expect(f.boot).not.toHaveBeenCalled();
  });
});
