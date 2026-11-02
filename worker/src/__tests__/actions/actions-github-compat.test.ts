// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it, vi } from 'vitest';
import { JobRunner } from '../../actions/job-runner';
import { call } from '../helpers/app';
import { resetAccessRuntimeFixture } from '../helpers/access-runtime';
import {
  evaluate,
  HASH_FILES,
  hashFilesKey,
  HashFilesNeeded,
} from '../../actions/expressions';
import {
  harness,
  pushFiles,
  runDetail,
  runs,
  script,
  setup,
} from '../helpers/actions';

/** What GitHub Actions does, and CloudForge Actions must do the same, so workflows written for GitHub run as they are. */

describe('hashFiles()', () => {
  it('从步骤上下文里取已算好的结果；没有时要求执行器去容器计算', () => {
    const key = hashFilesKey(['**/package-lock.json', '!x/**'], false);
    const ctx = { [HASH_FILES]: { [key]: 'abc' } };
    expect(evaluate("hashFiles('**/package-lock.json', '!x/**')", ctx)).toBe(
      'abc'
    );
    let needed: unknown;
    try {
      evaluate("hashFiles('--follow-symbolic-links', 'a', 'b')", {});
    } catch (e) {
      needed = e;
    }
    expect(needed).toBeInstanceOf(HashFilesNeeded);
    expect(needed).toMatchObject({ patterns: ['a', 'b'], follow: true });
    expect(() => evaluate('hashFiles()', {})).toThrow(/between 1 and 64/);
  });

  it('在容器里按步骤时机计算，可用于 if、env、with 和 run，组合动作里同样可用', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo build > dist.txt
      - if: hashFiles('requirements.txt') != ''
        run: echo never-without-requirements
      - name: key \${{ hashFiles('dist.txt') }}
        env:
          KEY: deps-\${{ hashFiles('**/package-lock.json', '!node_modules/**') }}
        run: echo "$KEY \${{ hashFiles('dist.txt') }}"
      - uses: ./.github/actions/greet
`,
      '.github/actions/greet/action.yml': `name: greet
runs:
  using: composite
  steps:
    - run: echo "inner \${{ hashFiles('dist.txt') }}"
      shell: bash
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({}), {
      hashFiles: (patterns) =>
        patterns[0] === 'requirements.txt'
          ? ''
          : patterns[0] === 'dist.txt'
            ? 'd'.repeat(64)
            : 'a'.repeat(64),
    });
    expect(await h.run(queued.id)).toBe('success');
    const scripts = h.requests.map(script).filter((x) => !x.includes('git'));
    expect(scripts).toContain(`echo "$KEY ${'d'.repeat(64)}"`);
    expect(scripts).toContain(`echo "inner ${'d'.repeat(64)}"`);
    expect(scripts.join('\n')).not.toContain('never');
    const keyStep = h.requests.find((r) => script(r).startsWith('echo "$KEY'))!;
    expect(keyStep.env.KEY).toBe(`deps-${'a'.repeat(64)}`);
    // Each asked once per step, after the steps before it ran (so files they made count).
    const asked = h.hashed.map((x) => x.patterns.join(' '));
    expect(asked.filter((x) => x === 'dist.txt')).toHaveLength(2);
    expect(asked).toContain('**/package-lock.json !node_modules/**');
    expect(asked).toContain('requirements.txt');
    const first = h.hashed.find((x) => x.patterns[0] === 'dist.txt')!;
    expect(h.requests.slice(0, first.after).map(script)).toContain(
      'echo build > dist.txt'
    );
    // Outside the step's durable step, each hash is a durable step of its own (replays reuse it).
    expect(h.stepNames.filter((n) => n.includes(':hashFiles:'))).toHaveLength(
      3
    );
  });

  it('容器计算失败时，该步骤报错失败', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ hashFiles('**') }}"
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({}), {
      hashFiles: () => {
        throw new Error("hashFiles('**') failed: too slow");
      },
    });
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.requests.map(script).join('\n')).not.toContain('echo "');
  });

  it('哈希准入被拒绝时不重启已执行命令，continue-on-error 和 always 也不能继续执行', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: deploy-once
      - run: echo "\${{ hashFiles('lock') }}"
        continue-on-error: true
      - run: forbidden
        if: always()
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({}), {
      retrySteps: true,
      hashFiles: async (patterns, follow) => {
        const DB = await resetAccessRuntimeFixture({ seed: false });
        await DB.prepare('DROP TABLE access_runtime_state').run();
        const exec = vi.fn();
        const runner = Object.assign(Object.create(JobRunner.prototype), {
          env: { DB },
          ctx: { container: { running: true, exec } },
        }) as JobRunner;
        try {
          const refusal = await runner.hashFiles(patterns, follow);
          expect(refusal).toEqual({ refused: 'runtime-admission' });
          expect(exec).not.toHaveBeenCalled();
          return JSON.parse(JSON.stringify(refusal));
        } finally {
          await resetAccessRuntimeFixture();
        }
      },
    });
    expect(await h.run(run.id)).toBe('failure');
    expect(h.requests.map(script)).toEqual(['deploy-once']);
    expect(h.boots).toHaveLength(1);
  });

  it('哈希拒绝作为普通数据保存并在重放时保留终止语义', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: deploy-once
      - run: echo "\${{ hashFiles('lock') }}"
        continue-on-error: true
      - run: forbidden
        if: always()
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const durableResults = new Map<string, unknown>();
    const h = harness(s.t, () => ({}), {
      durableResults,
      retrySteps: true,
      hashFiles: () => ({ refused: 'runtime-admission' }),
    });
    expect(await h.run(run.id)).toBe('failure');
    const hashKey = h.stepNames.find((name) => name.includes(':hashFiles:'))!;
    // Durable callbacks must preserve terminal control flow as data, not a custom Error prototype.
    expect(structuredClone(durableResults.get(hashKey))).toEqual({
      refused: 'runtime-admission',
    });
    await s.t.env.DB.prepare(
      "UPDATE workflow_runs SET status='in_progress', conclusion=NULL, completed_at=NULL WHERE id=?"
    )
      .bind(run.id)
      .run();
    expect(await h.run(run.id)).toBe('failure');
    expect(h.hashed).toHaveLength(1);
    expect(h.requests.map(script)).toEqual(['deploy-once']);
    expect(h.boots).toHaveLength(1);
  });

  it('前序命令失败后 always 哈希被拒绝仍停止后续命令和已有 post', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/cleanup
      - run: fail-before-hash
      - if: always()
        run: echo "\${{ hashFiles('lock') }}"
        continue-on-error: true
      - if: always()
        run: forbidden
`,
      '.github/actions/cleanup/action.yml': `name: cleanup
runs:
  using: node24
  main: main.js
  post: post.js
  post-if: always()
`,
      '.github/actions/cleanup/main.js': '',
      '.github/actions/cleanup/post.js': '',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const h = harness(
      s.t,
      (request) =>
        script(request) === 'fail-before-hash' ? { exitCode: 1 } : {},
      {
        retrySteps: true,
        hashFiles: () => ({ refused: 'runtime-admission' }),
      }
    );
    expect(await h.run(run.id)).toBe('failure');
    expect(h.hashed).toHaveLength(1);
    expect(h.requests).toHaveLength(2);
    expect(h.requests.map(script).join('\n')).not.toContain('post.js');
    expect(h.requests.map(script).join('\n')).not.toContain('forbidden');
    expect(h.boots).toHaveLength(1);
    const detail = await runDetail(s.t, s.admin, run.runNumber);
    expect(detail.jobs[0].steps[3]).toMatchObject({
      conclusion: 'failure',
    });
  });

  it('重放复用每个步骤的哈希结果，不再次读取改变后的工作区', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ hashFiles('lock') }}"
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const durableResults = new Map<string, unknown>();
    const h = harness(s.t, () => ({}), {
      durableResults,
      hashFiles: () => 'a'.repeat(64),
    });
    expect(await h.run(run.id)).toBe('success');
    expect(h.hashed).toHaveLength(1);
    await s.t.env.DB.prepare(
      "UPDATE workflow_runs SET status='in_progress', conclusion=NULL, completed_at=NULL WHERE id=?"
    )
      .bind(run.id)
      .run();
    expect(await h.run(run.id)).toBe('success');
    expect(h.hashed).toHaveLength(1);
    expect(h.requests).toHaveLength(1);
  });

  it('复合动作内部哈希被拒绝时同样停止后续命令并保留已完成子命令', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/check
        continue-on-error: true
      - run: forbidden
        if: always()
`,
      '.github/actions/check/action.yml': `name: check
runs:
  using: composite
  steps:
    - run: deploy-once
      shell: bash
    - run: echo "\${{ hashFiles('lock') }}"
      shell: bash
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({}), {
      retrySteps: true,
      hashFiles: () => ({ refused: 'runtime-admission' }),
    });
    expect(await h.run(run.id)).toBe('failure');
    expect(h.requests.map(script)).toEqual(['deploy-once']);
    expect(h.boots).toHaveLength(1);
  });
});

describe('步骤显示名', () => {
  it('显式步骤名称中的秘密在写入数据库前脱敏', async () => {
    const s = await setup();
    const secret = 'step-name-secret-123456';
    expect(
      (
        await call(s.t, '/api/repos/octocat/app/actions/secrets/TOKEN', {
          cookie: s.admin,
          method: 'PUT',
          json: { value: secret },
        })
      ).status
    ).toBe(200);
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy \${{ secrets.TOKEN }}
        run: echo done
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    expect(await harness(s.t).run(run.id)).toBe('success');
    const detail = await runDetail(s.t, s.admin, run.runNumber);
    expect(detail.jobs[0].steps[1].name).toBe('Deploy ***');
    expect(JSON.stringify(detail)).not.toContain(secret);
  });
  it('name: 在步骤开始时求值；未写 name 的步骤显示原样的首行', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      v: \${{ steps.v.outputs.v }}
    steps:
      - id: v
        run: echo "v=1.2.3" >> "$GITHUB_OUTPUT"
      - name: Release \${{ steps.v.outputs.v }}
        run: echo ok
  report:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: echo "build=\${{ needs.build.result }}"
      - name: After \${{ needs.build.outputs.v }}
        if: false
        run: echo skipped
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, (r) =>
      script(r).includes('GITHUB_OUTPUT') ? { outputs: { v: '1.2.3' } } : {}
    );
    expect(await h.run(queued.id)).toBe('success');
    const detail = await runDetail(s.t, s.admin, queued.runNumber);
    const names = (key: string) =>
      detail.jobs
        .find((j) => j.name === key)!
        .steps.map((st) => st.name)
        .slice(1, -1);
    expect(names('build')).toEqual([
      'Run echo "v=1.2.3" >> "$GITHUB_OUTPUT"',
      'Release 1.2.3',
    ]);
    expect(names('report')).toEqual([
      'Run echo "build=${{ needs.build.result }}"',
      'After 1.2.3',
    ]);
  });
});

describe('事件文件与旧 load 重放', () => {
  it('事件文件写入失败是命令前的准备失败，不重启或重放已完成命令', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: deploy-once
      - run: prepare-file-fails
        continue-on-error: true
      - run: forbidden
        if: always()
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const exec = vi.fn(async () => {
      throw new Error('event storage unavailable');
    });
    const runner = Object.assign(Object.create(JobRunner.prototype), {
      env: s.t.env,
      ctx: { container: { running: true, exec } },
    }) as JobRunner;
    const executed: string[] = [];
    const h = harness(
      s.t,
      async (req) => {
        if (script(req) === 'prepare-file-fails') {
          const result = await runner.runStep(req);
          expect(result.preparationError).toBe('event-file');
          expect(result.interrupted).toBeUndefined();
          return result;
        }
        executed.push(script(req));
        return {};
      },
      { retrySteps: true }
    );
    expect(await h.run(run.id)).toBe('failure');
    expect(executed).toEqual(['deploy-once']);
    expect(exec).toHaveBeenCalledOnce();
    expect(h.boots).toHaveLength(1);
  });
  it('普通脚本收到相同的完整事件文件，旧缓存上下文仍能恢复 minimal 事件', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: first
      - run: echo "\${{ github.event.repository.full_name }}"
`,
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    const durableResults = new Map<string, unknown>();
    const h = harness(s.t, () => ({}), { durableResults });
    expect(await h.run(run.id)).toBe('success');
    expect(h.requests[1].env.GITHUB_EVENT_PATH).toBe(
      '/tmp/cloudforge-event.json'
    );
    expect(JSON.parse(h.requests[1].eventPayload!)).toMatchObject({
      repository: { full_name: 'octocat/app' },
      after: run.headSha,
    });
    expect(script(h.requests[1])).toBe('echo "octocat/app"');
    const cached = durableResults.get('load') as { eventPayload?: unknown };
    delete cached.eventPayload;
    for (const key of durableResults.keys())
      if (
        /:step:3(?::done)?$|:complete$|^(finish-run|auto-merge|states)$/.test(
          key
        )
      )
        durableResults.delete(key);
    await s.t.env.DB.prepare(
      "UPDATE workflow_runs SET status='in_progress', conclusion=NULL, completed_at=NULL WHERE id=?"
    )
      .bind(run.id)
      .run();
    h.requests.length = 0;
    expect(await h.run(run.id)).toBe('success');
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].eventPayload).toBe('{}');
  });
});
