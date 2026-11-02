// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { runInDurableObject } from 'cloudflare:test';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from '../helpers/app';
import { commitPaths } from '../helpers/seed';
import { actionsQueue } from '../../actions/queue';
import type { ActionsQueue } from '../../actions/queue';
import {
  CI,
  harness,
  pat,
  push,
  pushFiles,
  runDetail,
  runs,
  script,
  setup,
  type Run,
} from '../helpers/actions';

describe('Actions 触发器', () => {
  it('按各工作流自身的最新运行命名，而非仓库的最新运行', async () => {
    const s = await setup();
    const format = (name: string) => `name: ${name}
on: push
jobs:
  prettier:
    runs-on: ubuntu-latest
    steps:
      - run: echo format
`;
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': CI,
      '.github/workflows/format.yml': format('Format'),
    });
    // Rename the format workflow: its newest run is now the repository's newest run too.
    await pushFiles(
      s,
      'main',
      {
        '.github/workflows/ci.yml': CI,
        '.github/workflows/format.yml': format('Prettier'),
      },
      'Rename format'
    );
    const list = await runs(s.t, s.admin);
    expect(list.workflows).toEqual([
      { path: '.github/workflows/ci.yml', name: 'CI' },
      { path: '.github/workflows/format.yml', name: 'Prettier' },
    ]);
  });

  it('推送新增工作流时创建排队运行，并启动其 Workflow', async () => {
    const s = await setup();
    const sha = await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': CI,
      'README.md': '# app',
    });
    const list = await runs(s.t, s.admin);
    expect(list.configured).toBe(true);
    expect(list.workflows).toEqual([
      { path: '.github/workflows/ci.yml', name: 'CI' },
    ]);
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({
      runNumber: 1,
      name: 'CI',
      event: 'push',
      refName: 'main',
      headSha: sha,
      displayTitle: 'Add CI',
      actor: { username: 'octocat' },
      status: 'queued',
    });
    expect(s.t.actions.started).toEqual([
      { id: list.runs[0].id, params: { runId: list.runs[0].id } },
    ]);

    const { jobs } = await runDetail(s.t, s.admin, 1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].steps.map((x) => x.name)).toEqual([
      'Set up job',
      'Run actions/checkout@v4',
      'Run echo building',
      'Run npm test',
      'Complete job',
    ]);
  });

  it('遵循分支过滤规则，忽略不包含工作流的推送', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { 'README.md': 'no workflows' });
    await pushFiles(s, 'feature', { '.github/workflows/ci.yml': CI });
    expect((await runs(s.t, s.admin)).totalCount).toBe(0);
    expect(s.t.actions.started).toHaveLength(0);
  });

  it('将无效工作流文件记录为失败运行，且不启动执行', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/bad.yml': 'on: push\njobs:\n  a:\n    steps: []\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    expect(run).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(run.errorMessage).toContain(
      'Invalid workflow file: .github/workflows/bad.yml'
    );
    expect(s.t.actions.started).toHaveLength(0);
  });

  it('站点限制最大运行器后，要求更大规格的工作流记录为失败运行', async () => {
    const s = await setup();
    const set = await call(s.t, '/api/admin/settings/actions.max_runner_size', {
      cookie: s.admin,
      method: 'PUT',
      json: { value: 'standard-2' },
    });
    expect(set.status).toBe(200);
    await pushFiles(s, 'main', {
      '.github/workflows/big.yml':
        'on: push\njobs:\n  a:\n    runs-on: cloudforge-standard-4\n    steps:\n      - run: x\n',
    });
    const [run] = (await runs(s.t, s.admin)).runs;
    expect(run).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(run.errorMessage).toContain('larger than this instance allows');
    expect(s.t.actions.started).toHaveLength(0);
  });

  it('PR 创建或其分支变化时运行 pull_request 工作流', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    await pushFiles(s, 'feature', {
      '.github/workflows/ci.yml': CI,
      'a.txt': 'one',
    });
    const pr = await call(s.t, '/api/repos/octocat/app/pulls', {
      cookie: s.admin,
      json: { title: 'Add a', base: 'main', head: 'feature' },
    });
    expect(pr.status).toBe(201);
    await settle(s.t);
    let list = await runs(s.t, s.admin);
    expect(list.runs[0]).toMatchObject({
      event: 'pull_request',
      pullRequestNumber: 1,
      displayTitle: 'Add a',
    });

    const head = await pushFiles(s, 'feature', {
      '.github/workflows/ci.yml': CI,
      'a.txt': 'two',
    });
    list = await runs(s.t, s.admin);
    // The feature push itself does not match `branches: [main]`; the PR sync does.
    expect(list.runs.map((r) => [r.event, r.headSha])).toEqual([
      ['pull_request', head],
      ['pull_request', expect.any(String)],
      ['push', expect.any(String)],
    ]);
  });

  it('合并后为目标分支运行 push 工作流', async () => {
    const s = await setup();
    const main = await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    // Branched from main's tip: merging fast-forwards main to the head, whose checks passed.
    s.repo.refs.set('refs/heads/feature', main);
    await pushFiles(s, 'feature', {
      '.github/workflows/ci.yml': CI,
      'b.txt': 'b',
    });
    await call(s.t, '/api/repos/octocat/app/pulls', {
      cookie: s.admin,
      json: { title: 'Add b', base: 'main', head: 'feature' },
    });
    await settle(s.t);
    // The pull request's run passed: the merge button refuses while checks run.
    await s.t.env.DB.prepare(
      "UPDATE workflow_runs SET status = 'completed', conclusion = 'success'"
    ).run();
    const merged = await call(s.t, '/api/repos/octocat/app/pulls/1/merge', {
      cookie: s.admin,
      json: { approve: true },
    });
    expect(merged.status).toBe(200);
    const { sha } = (await merged.json()) as { sha: string };
    await settle(s.t);
    const [latest] = (await runs(s.t, s.admin)).runs;
    expect(latest).toMatchObject({
      event: 'push',
      refName: 'main',
      headSha: sha,
    });
  });

  it('未配置 Actions 时不执行任何操作', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'app', addReadme: true },
    });
    const repo = [...t.fake.repos.values()][0];
    const old = repo.refs.get('refs/heads/main')!;
    const sha = await commitPaths(
      repo,
      'main',
      { '.github/workflows/ci.yml': CI },
      'CI',
      { moveRef: false }
    );
    await push(
      t,
      await pat(t, admin),
      '/octocat/app.git',
      'refs/heads/main',
      old,
      sha
    );
    const list = await runs(t, admin);
    expect(list).toMatchObject({ configured: false, totalCount: 0 });
  });
});

describe('Actions 执行', () => {
  it('运行结束时确定拉取请求状态', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t);
    await h.run(queued.id);
    expect(h.stepNames).toContain('states');
  });

  it('按顺序执行步骤，使用脱敏令牌检出代码并存储日志', async () => {
    const s = await setup();
    const sha = await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t);
    expect(await h.run(queued.id)).toBe('success');

    const checkout = h.requests[0];
    expect(script(checkout)).toContain('git -c http.extraHeader');
    expect(checkout.env.TARGET).toBe(sha);
    expect(checkout.env.PUBLIC_URL).toBe('http://test.local/octocat/app.git');
    expect(checkout.masks).toEqual([checkout.env.CLOUDFORGE_TOKEN]);
    expect(h.requests.slice(1).map(script)).toEqual([
      'echo building',
      'npm test',
    ]);
    expect(h.requests[1]).toMatchObject({ cwd: '/workspace' });
    expect(h.requests[1].env).toMatchObject({
      CI: 'true',
      GITHUB_SHA: sha,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'octocat/app',
      GITHUB_ACTOR: 'octocat',
    });

    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(run).toMatchObject({ status: 'completed', conclusion: 'success' });
    expect(jobs[0]).toMatchObject({
      status: 'completed',
      conclusion: 'success',
    });
    expect(jobs[0].steps.every((x) => x.conclusion === 'success')).toBe(true);
    expect(h.destroyed).toEqual([jobs[0].id]);

    const log = await call(
      s.t,
      `/api/repos/octocat/app/actions/runs/1/jobs/${jobs[0].id}/steps/3/logs`,
      { cookie: s.admin }
    );
    expect(await log.text()).toBe('ran echo building');
    const setupLog = await call(
      s.t,
      `/api/repos/octocat/app/actions/runs/1/jobs/${jobs[0].id}/steps/1/logs`,
      { cookie: s.admin }
    );
    expect(await setupLog.text()).toContain('standard-2');
  });

  it('失败后跳过后续步骤，但仍运行 if: always() 步骤', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: exit 1
      - run: echo never
      - if: always()
        run: echo cleanup
      - if: failure()
        run: echo report
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, (r) =>
      script(r) === 'exit 1' ? { exitCode: 1, log: 'boom' } : {}
    );
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.requests.map(script)).toEqual([
      'exit 1',
      'echo cleanup',
      'echo report',
    ]);
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(run.conclusion).toBe('failure');
    expect(jobs[0].steps.map((x) => x.conclusion)).toEqual([
      'success',
      'failure',
      'skipped',
      'success',
      'success',
      'success',
    ]);
    const log = await call(
      s.t,
      `/api/repos/octocat/app/actions/runs/1/jobs/${jobs[0].id}/steps/2/logs`,
      { cookie: s.admin }
    );
    expect(await log.text()).toContain('Process completed with exit code 1');
  });

  it('在步骤和作业间传递输出、GITHUB_ENV 和 needs', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
env:
  GREETING: hello
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: \${{ steps.v.outputs.version }}
    steps:
      - id: v
        run: echo "version=1.2.3" >> "$GITHUB_OUTPUT"
      - run: echo "\${{ steps.v.outputs.version }} \${{ env.GREETING }} $FROM_ENV"
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploying \${{ needs.build.outputs.version }}"
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, (r) =>
      script(r).includes('GITHUB_OUTPUT')
        ? { outputs: { version: '1.2.3' }, envAdds: { FROM_ENV: 'set' } }
        : {}
    );
    expect(await h.run(queued.id)).toBe('success');
    expect(h.requests.map(script)).toEqual([
      'echo "version=1.2.3" >> "$GITHUB_OUTPUT"',
      'echo "1.2.3 hello $FROM_ENV"',
      'echo "deploying 1.2.3"',
    ]);
    expect(h.requests[1].env.FROM_ENV).toBe('set');
    expect(h.requests[1].env.GREETING).toBe('hello');
  });

  it('跳过 needs 依赖失败的作业，并分别运行矩阵作业', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - run: test-\${{ matrix.node }}
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: deploy
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, (r) =>
      script(r) === 'test-22' ? { exitCode: 1 } : {}
    );
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.requests.map(script).sort()).toEqual(['test-20', 'test-22']);
    const { jobs } = await runDetail(s.t, s.admin, 1);
    const byName = Object.fromEntries(jobs.map((j) => [j.name, j.conclusion]));
    expect(byName).toEqual({
      'test (20)': 'success',
      'test (22)': 'failure',
      deploy: 'skipped',
    });
  });

  it('无法执行动作时明确报告失败，除非启用 continue-on-error', async () => {
    const s = await setup();
    await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: docker://alpine:3
        continue-on-error: true
      - uses: ./.github/actions/missing
      - run: echo after
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t);
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.requests).toHaveLength(0);
    const { jobs } = await runDetail(s.t, s.admin, 1);
    expect(jobs[0].steps.map((x) => x.conclusion)).toEqual([
      'success',
      'success',
      'failure',
      'skipped',
      'skipped', // Local action Post slot: its main step failed before loading metadata.
      'success',
    ]);
    const log = await call(
      s.t,
      `/api/repos/octocat/app/actions/runs/1/jobs/${jobs[0].id}/steps/3/logs`,
      { cookie: s.admin }
    );
    expect(await log.text()).toContain(
      './.github/actions/missing has no action.yml'
    );
  });
});

describe('Actions 中断后的重启', () => {
  const stepLog = async (
    s: Awaited<ReturnType<typeof setup>>,
    jobId: string,
    n: number
  ) =>
    (
      await call(
        s.t,
        `/api/repos/octocat/app/actions/runs/1/jobs/${jobId}/steps/${n}/logs`,
        { cookie: s.admin }
      )
    ).text();
  const ranScripts = (h: ReturnType<typeof harness>) => h.requests.map(script);

  it('运行器中断后，在新容器中从头重启作业', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    let interrupted = false;
    const h = harness(s.t, (r) => {
      if (script(r) === 'npm test' && !interrupted) {
        interrupted = true;
        // What the Workflow sees when a deploy resets the JobRunner mid-call.
        throw new Error('Durable Object reset because its code was updated.');
      }
      return {};
    });
    expect(await h.run(queued.id)).toBe('success');
    expect(ranScripts(h).filter((x) => !x.startsWith('mkdir'))).toEqual([
      'echo building',
      'npm test',
      'echo building',
      'npm test',
    ]);
    expect(h.requests).toHaveLength(6);
    expect(new Set(h.stepNames).size).toBe(h.stepNames.length);
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(h.boots).toEqual([jobs[0].id, jobs[0].id]);
    // Destroyed once before the restart and once when the job completed.
    expect(h.destroyed).toEqual([jobs[0].id, jobs[0].id]);
    expect(run).toMatchObject({ status: 'completed', conclusion: 'success' });
    expect(jobs[0].steps.every((x) => x.conclusion === 'success')).toBe(true);
    const setupLog = await stepLog(s, jobs[0].id, 1);
    expect(setupLog).toContain(
      'Restarted after the runner was interrupted (attempt 2 of 3).'
    );
    expect(setupLog).toContain(
      'Step 4 (Run npm test) was interrupted: Durable Object reset because its code was updated.'
    );
    expect(await stepLog(s, jobs[0].id, 4)).toBe('ran npm test');
    // Usage & cost: one runner session per attempt, both stopped, at the job's size.
    const sessions = await s.t.env.DB.prepare(
      'SELECT id, job_id, repository_id, instance_type, stopped_at FROM runner_sessions ORDER BY id'
    ).all<Record<string, unknown>>();
    expect(sessions.results.map((x) => x.id)).toEqual([
      `${jobs[0].id}:1`,
      `${jobs[0].id}:2`,
    ]);
    for (const x of sessions.results) {
      expect(x).toMatchObject({
        job_id: jobs[0].id,
        instance_type: 'standard-2',
      });
      expect(x.repository_id).toBeTruthy();
      expect(x.stopped_at).not.toBeNull();
    }
  });

  it('运行器报告步骤执行期间容器停止时重启', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    let n = 0;
    const h = harness(s.t, (r) =>
      script(r) === 'echo building' && n++ === 0
        ? { exitCode: 137, interrupted: 'The runner container stopped' }
        : {}
    );
    expect(await h.run(queued.id)).toBe('success');
    expect(h.boots).toHaveLength(2);
  });

  it('不重试自身执行失败的步骤', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, (r) =>
      script(r) === 'npm test' ? { exitCode: 1, log: 'tests failed' } : {}
    );
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.boots).toHaveLength(1);
    expect(ranScripts(h).filter((x) => x === 'npm test')).toHaveLength(1);
    const { jobs } = await runDetail(s.t, s.admin, 1);
    expect(await stepLog(s, jobs[0].id, 1)).not.toContain('Restarted');
  });

  it('连续三次中断后停止尝试，并给出明确提示', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, (r) => {
      if (script(r) === 'echo building')
        throw new Error('Network connection lost.');
      return {};
    });
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.boots).toHaveLength(3);
    expect(ranScripts(h).filter((x) => x === 'echo building')).toHaveLength(3);
    // The last attempt does not go on to run steps on a runner that is gone.
    expect(ranScripts(h)).not.toContain('npm test');
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(run).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(jobs[0].steps.map((x) => x.conclusion)).toEqual([
      'success',
      'success',
      'failure',
      'skipped',
      'success',
    ]);
    expect(await stepLog(s, jobs[0].id, 1)).toContain(
      'Restarted after the runner was interrupted (attempt 3 of 3).'
    );
    const log = await stepLog(s, jobs[0].id, 3);
    expect(log).toContain('Error: Network connection lost.');
    expect(log).toContain(
      'The runner was interrupted on all 3 attempts, so the job was not restarted again.'
    );
  });

  it('将容器启动失败记录到 Set up job 日志和运行错误中', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({}), { failBoot: 'No container capacity' });
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.requests).toHaveLength(0);
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(run.errorMessage).toBe(
      'Job "test" could not start its runner: No container capacity'
    );
    expect(jobs[0].steps[0].conclusion).toBe('failure');
    expect(await stepLog(s, jobs[0].id, 1)).toBe(
      'Could not start the runner: No container capacity'
    );
  });

  it('Set up job 未产生日志时，记录其整体失败原因', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, () => ({}), {
      failSetup: 'Execution timed out after 600000ms',
    });
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.requests).toHaveLength(0);
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(run.errorMessage).toContain('Execution timed out after 600000ms');
    expect(jobs[0].steps[0].conclusion).toBe('failure');
    expect(await stepLog(s, jobs[0].id, 1)).toBe(
      'Could not start the runner: Execution timed out after 600000ms'
    );
  });

  it('所属运行已取消时，不重启作业', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, async (r) => {
      if (script(r) === 'npm test') {
        const res = await call(
          s.t,
          '/api/repos/octocat/app/actions/runs/1/cancel',
          { cookie: s.admin, method: 'POST' }
        );
        expect(res.status).toBe(200);
        // Cancelling destroys the container under the running step.
        throw new Error('The runner container is no longer running');
      }
      return {};
    });
    expect(await h.run(queued.id)).toBe('cancelled');
    expect(h.boots).toHaveLength(1);
    expect(ranScripts(h).filter((x) => x === 'npm test')).toHaveLength(1);
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(run).toMatchObject({ status: 'completed', conclusion: 'cancelled' });
    expect(jobs[0].conclusion).toBe('cancelled');
  });
});

describe('Actions 接口', () => {
  it('读取已崩溃运行时停止失败保留容量，真实队列alarm成功停止后才回收', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [run] = (await runs(s.t, s.admin)).runs;
    const jobId = (await runDetail(s.t, s.admin, 1)).jobs[0].id;
    await s.t.env.DB.batch([
      s.t.env.DB.prepare(
        "UPDATE workflow_jobs SET status='in_progress' WHERE id=?"
      ).bind(jobId),
      s.t.env.DB.prepare(
        'UPDATE workflow_runs SET created_at=created_at-600 WHERE id=?'
      ).bind(run.id),
      s.t.env.DB.prepare(
        "INSERT INTO runner_sessions(id,job_id,instance_type,started_at,deadline_at) VALUES (?,?,'standard-2',?,?)"
      ).bind(`${jobId}:1`, jobId, Date.now(), Date.now() + 3_600_000),
    ]);
    const queue = actionsQueue(s.t.env);
    await queue.acquire({ jobId, runId: run.id, maxMinutes: 60, limit: 1 });
    const waiter = {
      jobId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      maxMinutes: 60,
      limit: 1,
    };
    await queue.acquire(waiter);
    s.t.actions.instanceStatus.set(run.id, 'errored');
    let fails = true;
    const getRunner = s.t.env.JOB_RUNNER.getByName.bind(s.t.env.JOB_RUNNER);
    Object.assign(s.t.env, {
      JOB_RUNNER: {
        getByName: (id: string) => ({
          ...getRunner(id),
          destroy: async () => {
            if (fails) throw new Error('container stop unavailable');
            await getRunner(id).destroy();
          },
        }),
      },
    });
    const response = await call(s.t, '/api/repos/octocat/app/actions/runs/1', {
      cookie: s.admin,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run: { status: 'completed', conclusion: 'failure' },
    });
    expect(
      await s.t.env.DB.prepare('SELECT status FROM workflow_jobs WHERE id=?')
        .bind(jobId)
        .first('status')
    ).toBe('in_progress');
    expect(
      await s.t.env.DB.prepare(
        'SELECT stopped_at FROM runner_sessions WHERE job_id=?'
      )
        .bind(jobId)
        .first('stopped_at')
    ).toBeNull();
    expect((await queue.acquire(waiter)).granted).toBe(false);
    const stub = s.t.env.ACTIONS_QUEUE.getByName('instance');
    expect(
      await runInDurableObject(stub, async (_obj, state) =>
        state.storage.getAlarm()
      )
    ).not.toBeNull();
    fails = false;
    await runInDurableObject(stub, async (obj) => {
      (obj as unknown as { env: CloudflareBindings }).env = s.t.env;
      await (obj as unknown as ActionsQueue).alarm();
    });
    expect(
      await s.t.env.DB.prepare('SELECT status FROM workflow_jobs WHERE id=?')
        .bind(jobId)
        .first('status')
    ).toBe('completed');
    expect(
      await s.t.env.DB.prepare(
        'SELECT stopped_at FROM runner_sessions WHERE job_id=?'
      )
        .bind(jobId)
        .first('stopped_at')
    ).toBeGreaterThan(0);
    expect((await queue.acquire(waiter)).granted).toBe(true);
  });

  it.each(['terminate', 'destroy'])(
    '取消运行的%s失败时保留真实容量与停止追踪，重试成功后才释放',
    async (failure) => {
      const s = await setup();
      await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
      const [run] = (await runs(s.t, s.admin)).runs;
      const { jobs } = await runDetail(s.t, s.admin, 1);
      const jobId = jobs[0].id;
      await s.t.env.DB.prepare(
        "UPDATE workflow_jobs SET status='in_progress' WHERE id=?"
      )
        .bind(jobId)
        .run();
      await s.t.env.DB.prepare(
        "INSERT INTO runner_sessions (id,job_id,instance_type,started_at,deadline_at) VALUES (?,?,'standard-2',?,?)"
      )
        .bind(`${jobId}:1`, jobId, Date.now(), Date.now() + 3_600_000)
        .run();
      const queue = actionsQueue(s.t.env);
      await queue.acquire({ jobId, runId: run.id, maxMinutes: 60, limit: 1 });
      const waiter = {
        jobId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
        maxMinutes: 60,
        limit: 1,
      };
      expect((await queue.acquire(waiter)).granted).toBe(false);
      let fails = true;
      const get = s.t.env.ACTIONS_RUN.get.bind(s.t.env.ACTIONS_RUN);
      const runner = s.t.env.JOB_RUNNER.getByName.bind(s.t.env.JOB_RUNNER);
      Object.assign(s.t.env, {
        ACTIONS_RUN: {
          ...s.t.env.ACTIONS_RUN,
          get: async (id: string) => {
            const instance = await get(id);
            return {
              ...instance,
              terminate: async () => {
                if (fails && failure === 'terminate')
                  throw new Error('Workflow stop unavailable');
                await instance.terminate();
              },
            };
          },
        },
        JOB_RUNNER: {
          getByName: (id: string) => ({
            ...runner(id),
            destroy: async () => {
              if (fails && failure === 'destroy')
                throw new Error('Container stop unavailable');
              await runner(id).destroy();
            },
          }),
        },
      });
      const path = '/api/repos/octocat/app/actions/runs/1/cancel';
      expect(
        (await call(s.t, path, { cookie: s.admin, method: 'POST' })).status
      ).toBe(200);
      await settle(s.t);
      expect(
        await s.t.env.DB.prepare('SELECT status FROM workflow_jobs WHERE id=?')
          .bind(jobId)
          .first('status')
      ).toBe('in_progress');
      expect(
        await s.t.env.DB.prepare(
          'SELECT stopped_at FROM runner_sessions WHERE job_id=?'
        )
          .bind(jobId)
          .first('stopped_at')
      ).toBeNull();
      expect((await queue.acquire(waiter)).granted).toBe(false);
      fails = false;
      expect(
        (await call(s.t, path, { cookie: s.admin, method: 'POST' })).status
      ).toBe(200);
      await settle(s.t);
      expect(
        await s.t.env.DB.prepare('SELECT status FROM workflow_jobs WHERE id=?')
          .bind(jobId)
          .first('status')
      ).toBe('completed');
      expect(
        await s.t.env.DB.prepare(
          'SELECT stopped_at FROM runner_sessions WHERE job_id=?'
        )
          .bind(jobId)
          .first('stopped_at')
      ).toBeGreaterThan(0);
      expect((await queue.acquire(waiter)).granted).toBe(true);
    }
  );

  it('取消运行并终止其 Workflow 和容器', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [run] = (await runs(s.t, s.admin)).runs;
    const bob = await addMember(s.t, s.admin, 'bob');
    const denied = await call(
      s.t,
      '/api/repos/octocat/app/actions/runs/1/cancel',
      { cookie: bob, method: 'POST' }
    );
    expect(denied.status).toBe(403);
    const running = (await runDetail(s.t, s.admin, 1)).jobs[0];
    await s.t.env.DB.prepare(
      "UPDATE workflow_jobs SET status='in_progress' WHERE id=?"
    )
      .bind(running.id)
      .run();
    const res = await call(
      s.t,
      '/api/repos/octocat/app/actions/runs/1/cancel',
      {
        cookie: s.admin,
        method: 'POST',
      }
    );
    expect(res.status).toBe(200);
    await settle(s.t);
    expect(s.t.actions.terminated).toEqual([run.id]);
    const { run: after, jobs } = await runDetail(s.t, s.admin, 1);
    expect(after).toMatchObject({
      status: 'completed',
      conclusion: 'cancelled',
    });
    expect(s.t.actions.destroyed).toEqual([jobs[0].id]);
    expect(jobs[0].steps.every((x) => x.status === 'completed')).toBe(true);
  });

  it('将已取消作业的运行器标记为停止，以统计用量', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [run] = (await runs(s.t, s.admin)).runs;
    const { jobs } = await runDetail(s.t, s.admin, 1);
    await s.t.env.DB.prepare(
      "UPDATE workflow_jobs SET status='in_progress' WHERE id=?"
    )
      .bind(jobs[0].id)
      .run();
    await s.t.env.DB.prepare(
      `INSERT INTO runner_sessions (id, job_id, repository_id, instance_type, started_at, stopped_at, deadline_at)
       VALUES (?, ?, NULL, 'standard-2', ?, NULL, ?)`
    )
      .bind(
        `${jobs[0].id}:1`,
        jobs[0].id,
        Date.now() - 60_000,
        Date.now() + 3_600_000
      )
      .run();
    expect(run.status).not.toBe('completed');
    await call(s.t, '/api/repos/octocat/app/actions/runs/1/cancel', {
      cookie: s.admin,
      method: 'POST',
    });
    await settle(s.t);
    const row = await s.t.env.DB.prepare(
      'SELECT stopped_at FROM runner_sessions'
    ).first<{ stopped_at: number | null }>();
    expect(row?.stopped_at).toBeGreaterThan(0);
  });

  it('在同一提交上将工作流重新运行一次', async () => {
    const s = await setup();
    const sha = await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const res = await call(s.t, '/api/repos/octocat/app/actions/runs/1/rerun', {
      cookie: s.admin,
      method: 'POST',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runNumber: 2 });
    const list = await runs(s.t, s.admin);
    expect(list.runs[0]).toMatchObject({
      runNumber: 2,
      headSha: sha,
      status: 'queued',
    });
    expect(s.t.actions.started).toHaveLength(2);
  });

  it('根据每个工作流的最新运行报告提交状态', async () => {
    const s = await setup();
    const sha = await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const status = async () =>
      (await (
        await call(s.t, `/api/repos/octocat/app/commits/${sha}/runs`, {
          cookie: s.admin,
        })
      ).json()) as { state: string | null; runs: Run[] };
    expect((await status()).state).toBe('pending');
    const [queued] = (await runs(s.t, s.admin)).runs;
    await harness(s.t, () => ({ exitCode: 1 })).run(queued.id);
    expect((await status()).state).toBe('failure');
    await call(s.t, '/api/repos/octocat/app/actions/runs/1/rerun', {
      cookie: s.admin,
      method: 'POST',
    });
    const [rerun] = (await runs(s.t, s.admin)).runs;
    await harness(s.t).run(rerun.id);
    const after = await status();
    expect(after.state).toBe('success');
    expect(after.runs.map((r) => r.runNumber)).toEqual([2]);
  });

  it('查看运行时，将 Workflow 已崩溃的运行标记为失败', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [run] = (await runs(s.t, s.admin)).runs;
    await s.t.env.DB.prepare(
      'UPDATE workflow_runs SET created_at = created_at - 600'
    ).run();
    s.t.actions.instanceStatus.set(run.id, 'errored');
    const { run: after } = await runDetail(s.t, s.admin, 1);
    expect(after).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(after.errorMessage).toContain('stopped unexpectedly');
  });

  it('从运行器提供运行中步骤的实时日志', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const { jobs } = await runDetail(s.t, s.admin, 1);
    await s.t.env.DB.prepare(
      "UPDATE workflow_steps SET status = 'in_progress' WHERE number = 2"
    ).run();
    s.t.actions.live.set(`${jobs[0].id}:2`, 'Fetching…');
    const res = await call(
      s.t,
      `/api/repos/octocat/app/actions/runs/1/jobs/${jobs[0].id}/steps/2/logs`,
      { cookie: s.admin }
    );
    expect(await res.text()).toBe('Fetching…');
  });

  it('删除仓库时一并删除步骤日志', async () => {
    const s = await setup();
    await pushFiles(s, 'main', { '.github/workflows/ci.yml': CI });
    const [queued] = (await runs(s.t, s.admin)).runs;
    await harness(s.t).run(queued.id);
    const { id } = (await (
      await call(s.t, '/api/repos/octocat/app', { cookie: s.admin })
    ).json()) as { id: string };
    // R2 is shared by the tests in this file, so count only this repository's logs.
    const listed = async () =>
      (await s.t.env.ACTIONS_LOGS.list({ prefix: `actions/${id}/` })).objects
        .length;
    expect(await listed()).toBeGreaterThan(0);
    const del = await call(s.t, '/api/repos/octocat/app', {
      cookie: s.admin,
      method: 'DELETE',
    });
    expect(del.ok).toBe(true);
    expect(await listed()).toBe(0);
  });
});

describe('Actions 缓存', () => {
  const NODE_CI = `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: yarn
      - run: yarn install --frozen-lockfile
`;
  const files = {
    '.github/workflows/ci.yml': NODE_CI,
    'package.json': '{"name":"app"}\n',
    'yarn.lock': '# yarn lockfile v1\n',
  };
  const repoId = async (t: TestEnv) =>
    (await t.env.DB.prepare('SELECT id FROM repositories').first<{
      id: string;
    }>())!.id;

  it('为 setup-node 缓存 node_modules：未命中时在作业结束后保存，下次运行时恢复', async () => {
    const s = await setup();
    await pushFiles(s, 'main', files);
    let [queued] = (await runs(s.t, s.admin)).runs;
    let h = harness(s.t);
    expect(await h.run(queued.id)).toBe('success');

    const { jobs } = await runDetail(s.t, s.admin, 1);
    expect(jobs[0].steps.map((x) => [x.name, x.conclusion])).toEqual([
      ['Set up job', 'success'],
      ['Run actions/checkout@v4', 'success'],
      ['Run actions/setup-node@v4', 'success'],
      ['Run yarn install --frozen-lockfile', 'success'],
      ['Post Run actions/setup-node@v4', 'success'],
      ['Complete job', 'success'],
    ]);
    // setup-node uses the preinstalled Node.js.
    const setupNode = script(h.requests[1]);
    expect(setupNode).not.toMatch(/\bn -q\b|npm install -g/);
    expect(setupNode).toContain('node-version 22 was requested');
    expect(setupNode).toMatch(
      /Cache not found for node-modules-yarn-linux-x64-node24-[0-9a-f]{32}/
    );
    // The post step uploads node_modules to R2 with a masked, pre-signed URL.
    const save = h.requests[3];
    expect(script(save)).toContain("'/workspace/node_modules'");
    const url = save.env.CACHE_URL;
    expect(url).toContain(
      `/cloudforge-actions-cache-test/actions-cache/${await repoId(s.t)}/refs~2fheads~2fmain/node-modules-yarn-`
    );
    expect(url).toContain('X-Amz-Signature=');
    expect(save.masks).toEqual([h.requests[0].env.CLOUDFORGE_TOKEN, url]);

    // Simulate the upload, then rerun on a new commit with the same lockfile.
    // The URL path is the object key verbatim, so S3 decodes nothing differently.
    const objectKey = new URL(url).pathname.split(
      '/cloudforge-actions-cache-test/'
    )[1];
    expect(objectKey).not.toContain('%');
    await s.t.env.ACTIONS_CACHE.put(objectKey, 'tarball');
    await pushFiles(s, 'main', { ...files, 'README.md': 'v2\n' }, 'Docs');
    [queued] = (await runs(s.t, s.admin)).runs;
    h = harness(s.t);
    expect(await h.run(queued.id)).toBe('success');
    const restore = h.requests[1];
    expect(script(restore)).toContain('Restoring cache: node-modules-yarn-');
    expect(script(restore)).toContain('cache-hit=true');
    expect(restore.env.CACHE_URL).toContain('X-Amz-Signature=');
    expect(restore.masks).toEqual([
      h.requests[0].env.CLOUDFORGE_TOKEN,
      restore.env.CACHE_URL,
    ]);
    // Exact hit: nothing to save, so the post step never reaches the runner.
    expect(h.requests).toHaveLength(3);
    const second = await runDetail(s.t, s.admin, 2);
    expect(second.jobs[0].steps[4]).toMatchObject({
      name: 'Post Run actions/setup-node@v4',
      conclusion: 'skipped',
    });
  });

  it('允许分支从默认分支恢复缓存，但只能保存到自身分支', async () => {
    const s = await setup();
    const id = await repoId(s.t);
    await s.t.env.ACTIONS_CACHE.put(
      `actions-cache/${id}/refs~2fheads~2fmain/deps-old.tar.zst`,
      'tarball'
    );
    await pushFiles(s, 'feature', {
      '.github/workflows/ci.yml': `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/cache@v4
        id: deps
        with:
          path: |
            node_modules
            ~/.cache/tool
          key: deps-new
          restore-keys: deps-
      - run: echo "hit=\${{ steps.deps.outputs.cache-hit }}"
`,
    });
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t);
    expect(await h.run(queued.id)).toBe('success');
    const restore = script(h.requests[0]);
    expect(restore).toContain('Restoring cache: deps-old');
    expect(restore).toContain('cache-hit=false'); // a restore key, not the exact key
    // The post step saves under the branch, never under main.
    const saveUrl = h.requests[2].env.CACHE_URL;
    expect(saveUrl).toContain(`/${id}/refs~2fheads~2ffeature/deps-new.tar.zst`);
    expect(script(h.requests[2])).toContain("'/root/.cache/tool'");
  });

  it('作业失败后不保存缓存', async () => {
    const s = await setup();
    await pushFiles(s, 'main', files);
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t, (req) =>
      script(req).startsWith('yarn install') ? { exitCode: 1 } : {}
    );
    expect(await h.run(queued.id)).toBe('failure');
    expect(h.requests).toHaveLength(3); // checkout, setup-node, install; no save
    const { jobs } = await runDetail(s.t, s.admin, 1);
    expect(jobs[0].steps[4]).toMatchObject({ conclusion: 'skipped' });
  });

  it('服务器未配置缓存时，无缓存运行', async () => {
    const s = await setup();
    (
      s.t.env as { ACTIONS_CACHE_BUCKET_NAME?: string }
    ).ACTIONS_CACHE_BUCKET_NAME = '';
    await pushFiles(s, 'main', files);
    const [queued] = (await runs(s.t, s.admin)).runs;
    const h = harness(s.t);
    expect(await h.run(queued.id)).toBe('success');
    expect(script(h.requests[1])).toContain('The Actions cache isn');
    expect(h.requests).toHaveLength(3);
  });

  it('超出仓库上限时淘汰最早条目，并在删除仓库时清除缓存', async () => {
    const { enforceCacheLimit, deleteRepositoryCache } =
      await import('../../actions/cache');
    const s = await setup();
    const id = await repoId(s.t);
    for (const k of ['a', 'b', 'c']) {
      await s.t.env.ACTIONS_CACHE.put(
        `actions-cache/${id}/r/${k}.tar.zst`,
        'x'.repeat(10)
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(await enforceCacheLimit(s.t.env, id, 20)).toEqual([
      `actions-cache/${id}/r/a.tar.zst`,
    ]);
    await deleteRepositoryCache(s.t.env, id);
    expect(
      (await s.t.env.ACTIONS_CACHE.list({ prefix: `actions-cache/${id}/` }))
        .objects
    ).toEqual([]);
  });
});

describe('列表中的提交检查', () => {
  it('在一次请求中返回各提交的合并检查结果，且拉取请求列出其头提交', async () => {
    const s = await setup();
    const first = await pushFiles(s, 'main', {
      '.github/workflows/ci.yml': CI,
    });
    const second = await pushFiles(
      s,
      'main',
      { '.github/workflows/ci.yml': CI, 'b.txt': 'b\n' },
      'Second'
    );
    const { runs: queued } = await runs(s.t, s.admin);
    // The older commit's run fails, the newer one's is still queued.
    const h = harness(s.t, () => ({ exitCode: 1 }));
    await h.run(queued.find((r) => r.headSha === first)!.id);

    const none = '0'.repeat(40);
    const res = await call(
      s.t,
      `/api/repos/octocat/app/commit-statuses?shas=${first},${second},${none}`,
      { cookie: s.admin }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<
      string,
      { state: string | null; runs: { name: string }[] }
    >;
    expect(body[first].state).toBe('failure');
    expect(body[second].state).toBe('pending');
    expect(body[none]).toEqual({ state: null, runs: [], statuses: [] });
    expect(body[first].runs.map((r) => r.name)).toEqual(['CI']);

    // A re-run supersedes the failed run: only the newest run per workflow counts.
    const failed = queued.find((r) => r.headSha === first)!;
    await call(
      s.t,
      `/api/repos/octocat/app/actions/runs/${failed.runNumber}/rerun`,
      { cookie: s.admin, method: 'POST' }
    );
    const retried = (await runs(s.t, s.admin)).runs.find(
      (r) => r.headSha === first && r.runNumber > failed.runNumber
    )!;
    await harness(s.t).run(retried.id);
    const after = (await (
      await call(
        s.t,
        `/api/repos/octocat/app/commit-statuses?shas=${first},${second}`,
        { cookie: s.admin }
      )
    ).json()) as typeof body;
    expect(after[first].state).toBe('success');
    expect(after[first].runs).toHaveLength(1);
    expect(after[second].state).toBe('pending');

    const bad = await call(
      s.t,
      '/api/repos/octocat/app/commit-statuses?shas=not-a-sha',
      { cookie: s.admin }
    );
    expect(bad.status).toBe(400);

    // Pull requests carry the commit their checks run on.
    await pushFiles(
      s,
      'feature',
      { '.github/workflows/ci.yml': CI, 'c.txt': 'c\n' },
      'Feature'
    );
    await call(s.t, '/api/repos/octocat/app/pulls', {
      cookie: s.admin,
      json: { title: 'Feature', base: 'main', head: 'feature' },
    });
    const list = (await (
      await call(s.t, '/api/repos/octocat/app/pulls', { cookie: s.admin })
    ).json()) as { pulls: { number: number; headSha: string | null }[] };
    expect(list.pulls[0].headSha).toBe(s.repo.refs.get('refs/heads/feature'));
  });
});
