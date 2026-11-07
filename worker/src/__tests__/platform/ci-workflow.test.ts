// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import ciText from '../../../../.github/workflows/ci.yml?raw';
import { evaluateCondition, type Value } from '../../actions/expressions';
import { instanceTypeFor, planJobs } from '../../actions/plan';
import { parseRelevanceInputs } from '../../actions/relevance';
import { githubContext } from '../../actions/trigger';
import { parseWorkflow, type JobDef } from '../../actions/workflow-file';

/**
 * CloudForge's own CI (.github/workflows/ci.yml) runs the tests split by module. These checks keep
 * that split honest: every test file runs in exactly one place, and the gate's wiring is right.
 */

/** This file: import.meta.glob leaves out the module that calls it. */
const SELF = 'worker/src/__tests__/platform/ci-workflow.test.ts';

/** Every file vitest runs (worker/vitest.config.ts `include`), from the repository root. Lazy: nothing is imported. */
const TEST_FILES = [
  SELF,
  ...Object.keys({
    ...import.meta.glob('/worker/src/__tests__/**/*.test.ts'),
    ...import.meta.glob('/src/lib/**/*.test.ts'),
  }).map((p) => p.slice(1)),
].sort();

const wf = parseWorkflow(ciText);
const job = (key: string) => {
  const j = wf.jobs.find((x) => x.key === key);
  if (!j) throw new Error(`ci.yml 中没有作业 ${key}`);
  return j;
};
const gate = job('gate');
const gateStep = gate.steps.find((s) => s.uses === 'cloudforge/relevance@v1')!;
const modules = parseRelevanceInputs(gateStep.with).modules.map((m) => m.name);
const testJobs = wf.jobs.filter((j) => j.key.startsWith('test-'));
/** Each module has exactly one job, test-<module>. */
const moduleOf = (j: JobDef) => modules.find((m) => j.key === `test-${m}`);

/** The arguments of every `yarn test …` step in a job. */
function filters(j: JobDef): string[] {
  return j.steps
    .filter((s) => s.run?.trim().startsWith('yarn test'))
    .flatMap((s) => s.run!.trim().split(/\s+/).slice(2));
}
/** A filter is a file path, or a directory ending in `/` that covers everything under it. */
const covers = (filter: string, file: string) =>
  filter.endsWith('/') ? file.startsWith(filter) : filter === file;

const moduleIf = (m: string) =>
  `always() && needs.build.result == 'success' && (needs.gate.result == 'skipped' || needs.gate.outputs.run-${m} == 'true')`;

describe('CI 工作流（.github/workflows/ci.yml）', () => {
  it('使用 CloudForge Actions 解析和规划', () => {
    const github = githubContext('octocat/cloudforge', {
      event: 'pull_request',
      ref: 'refs/pull/1/head',
      headSha: 'a'.repeat(40),
    }) as Record<string, Value>;
    const planned = planJobs(wf, github);
    expect(planned.map((j) => j.key)).toEqual([
      'build',
      'gate',
      ...testJobs.map((j) => j.key),
      'package',
    ]);
  });

  it('构建和模块作业在 CloudForge 使用 standard-4，在 GitHub 使用 ubuntu-latest', () => {
    const plan = (server_url: string) =>
      planJobs(wf, {
        ...githubContext('octocat/cloudforge', {
          event: 'push',
          ref: 'refs/heads/main',
          headSha: 'a'.repeat(40),
        }),
        server_url,
      } as Record<string, Value>);
    for (const server of ['', 'https://git.xyspace.dev']) {
      const sizes = Object.fromEntries(
        plan(server).map((j) => [j.key, instanceTypeFor(j.runsOn)])
      );
      expect(sizes.build, server).toBe('standard-4');
      expect(sizes.package, server).toBe('standard-4');
      for (const j of testJobs) expect(sizes[j.key], j.key).toBe('standard-4');
    }
    for (const j of plan('https://github.com'))
      expect(j.runsOn, j.key).toBe('ubuntu-latest');
  });

  it('打包作业仅在 GitHub 检查 Node 22.0.0 最低版本，CloudForge 运行器使用自带 Node.js', () => {
    const pkg = job('package');
    expect(pkg.needs).toEqual([]);
    const floor = pkg.steps.find(
      (s) =>
        s.uses?.startsWith('actions/setup-node@') &&
        s.with['node-version'] === '22.0.0'
    );
    const on = (server_url: string) =>
      evaluateCondition(floor!.if, { github: { server_url } });
    expect(on('https://github.com')).toBe(true);
    expect(on('https://git.xyspace.dev')).toBe(false);
  });

  it('能够发现测试文件，确认 import.meta.glob 在此可用', () => {
    expect(TEST_FILES.length).toBeGreaterThan(25);
    expect(TEST_FILES).toContain(
      'worker/src/__tests__/stack/stacking-landing.test.ts'
    );
    expect(new Set(TEST_FILES).size).toBe(TEST_FILES.length);
    expect(TEST_FILES.some((f) => f.startsWith('src/lib/'))).toBe(true);
  });

  it('每个测试文件恰好属于一个模块', () => {
    const homes = (file: string) =>
      wf.jobs
        .filter((j) => filters(j).some((f) => covers(f, file)))
        .map((j) => j.key);
    const wrong = TEST_FILES.map((f) => ({ file: f, jobs: homes(f) })).filter(
      (x) => x.jobs.length !== 1
    );
    // A new test file? Add it to the `yarn test` line of its module's job in ci.yml.
    expect(wrong).toEqual([]);
  });

  it('所有列出的测试文件均存在', () => {
    const stale = wf.jobs
      .flatMap((j) => filters(j))
      .filter((f) => !TEST_FILES.some((file) => covers(f, file)));
    expect(stale).toEqual([]);
  });

  it('测试步骤将路径保留在同一 shell 命令中', () => {
    for (const j of [job('build'), ...testJobs]) {
      const steps = j.steps.filter((s) =>
        s.run?.trim().startsWith('yarn test')
      );
      for (const s of steps) expect(s.run, j.key).not.toContain('\n');
    }
  });

  it('构建作业自身检查模块划分，确保门控无法跳过此检查', () => {
    expect(filters(job('build'))).toEqual([
      'worker/src/__tests__/platform/ci-workflow.test.ts',
    ]);
  });

  it('门控、其输出与模块作业保持一致', () => {
    // Every module has its test-<module> job; every test job belongs to a module.
    for (const m of modules) job(`test-${m}`);
    expect(testJobs.filter((j) => !moduleOf(j)).map((j) => j.key)).toEqual([]);
    expect(Object.keys(gate.outputs).sort()).toEqual(
      modules.map((m) => `run-${m}`).sort()
    );
    for (const m of modules)
      expect(gate.outputs[`run-${m}`], m).toBe(
        `\${{ steps.relevance.outputs.run-${m} }}`
      );
    for (const j of testJobs) {
      const m = moduleOf(j)!;
      expect(j.needs, j.key).toEqual(['build', 'gate']);
      expect(j.if, j.key).toBe(moduleIf(m));
      expect(filters(j).length, j.key).toBeGreaterThan(0);
    }
  });

  it('门控在 GitHub 跳过，在 CloudForge 运行', () => {
    const on = (server_url: string) =>
      evaluateCondition(gate.if, { github: { server_url } });
    expect(on('https://github.com')).toBe(false);
    expect(on('https://git.xyspace.dev')).toBe(true);
    expect(gate.needs).toEqual([]);
  });

  it('各模块的 if: 在 GitHub 运行、在 CloudForge 遵循门控，且构建失败后不运行', () => {
    for (const j of testJobs) {
      const m = moduleOf(j)!;
      const when = (
        gateResult: string,
        run: string | undefined,
        build = 'success'
      ) =>
        evaluateCondition(
          j.if,
          {
            needs: {
              build: { result: build, outputs: {} },
              gate: {
                result: gateResult,
                outputs: run === undefined ? {} : { [`run-${m}`]: run },
              },
            },
          },
          // The combined status the executor passes (worker/src/actions/executor.ts): a failed
          // dependency is failure; a skipped one blocks success() jobs, as on GitHub.
          {
            status:
              build === 'failure' || gateResult === 'failure'
                ? 'failure'
                : gateResult === 'skipped'
                  ? 'cancelled'
                  : 'success',
          }
        );
      expect(when('skipped', undefined), `${j.key} 在 GitHub 上`).toBe(true);
      expect(when('success', 'true'), `${j.key} 与变更相关`).toBe(true);
      expect(when('success', 'false'), `${j.key} 与变更无关`).toBe(false);
      expect(when('failure', undefined), `${j.key} 门控失败`).toBe(false);
      expect(when('skipped', undefined, 'failure'), `${j.key} 构建失败`).toBe(
        false
      );
    }
  });

  it('模块作业恢复当前提交的构建产物，缓存未命中时重新构建', () => {
    const key = '${{ github.sha }}';
    const save = job('build').steps.find((s) =>
      s.uses?.startsWith('actions/cache@')
    );
    expect(save?.with.key).toBe(`build-${key}`);
    expect(save?.with.path.split('\n').filter(Boolean)).toEqual([
      'node_modules',
      'dist',
    ]);
    for (const j of testJobs) {
      const restore = j.steps.find((s) => s.uses?.startsWith('actions/cache@'));
      expect(restore?.id, j.key).toBe('build-cache');
      expect(restore?.with.key, j.key).toBe(`build-${key}`);
      const fallback = j.steps.find(
        (s) => s.name === 'Install and build (cache miss)'
      );
      expect(fallback?.if, j.key).toBe(
        "steps.build-cache.outputs.cache-hit != 'true'"
      );
      // Config is staged before anything builds or tests.
      const order = j.steps.map((s) => s.name ?? s.uses ?? '');
      expect(order.indexOf('Stage config'), j.key).toBeLessThan(
        order.indexOf('Install and build (cache miss)')
      );
    }
  });
});
