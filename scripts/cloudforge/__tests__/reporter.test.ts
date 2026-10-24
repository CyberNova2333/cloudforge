import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TestModule, Vitest } from 'vitest/node';
import ChineseReporter from '../../test-reporter.ts';

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const reporter = fileURLToPath(
  new URL('../../test-reporter.ts', import.meta.url)
);

/** 用真正的 Vitest 子进程检验统计和失败诊断，避免只验证报告器自身的实现。 */
function run(files: Record<string, string>, args: string[] = []) {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, 'cloudforge-reporter-'));
  try {
    copyFileSync(reporter, join(directory, 'reporter.ts'));
    writeFileSync(
      join(directory, 'vitest.config.mts'),
      `import ChineseReporter from './reporter.ts';
       export default { test: {
         globals: true, include: ['*.test.ts'], exclude: [],
         reporters: [new ChineseReporter()],
         maxWorkers: 1, fileParallelism: false,
       } };`
    );
    for (const [name, source] of Object.entries(files))
      writeFileSync(join(directory, name), source);
    const result = spawnSync(process.execPath, [cli, 'run', ...args], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    // 只清理当前测试创建的临时目录，删除前核对实际绝对路径。
    const target = realpathSync(directory);
    const child = relative(parent, target);
    if (
      !child.startsWith('cloudforge-reporter-') ||
      child.includes(sep) ||
      resolve(parent, child) !== target
    )
      throw new Error('报告器测试临时目录超出预期范围');
    rmSync(target, { recursive: true, force: true });
  }
}

describe('中文测试报告器', () => {
  it('运行器启动错误不会被误报为没有匹配文件', () => {
    const output: string[] = [];
    const reporter = new ChineseReporter();
    const log = (...parts: string[]) => output.push(parts.join(' '));
    reporter.onInit({
      config: {},
      logger: {
        log,
        error: log,
        printError: (error: Error) => log(error.message),
      },
    } as unknown as Vitest);
    reporter.onTestRunStart([]);
    reporter.onTestRunEnd([], [{ message: 'runner startup error' }], 'passed');
    expect(output.join('\n')).toContain('测试结果：失败');
    expect(output.join('\n')).toContain('本轮没有测试文件完成运行');
    expect(output.join('\n')).toContain('runner startup error');
    expect(output.join('\n')).not.toContain('未找到匹配的测试文件');
  });

  it('监听模式中其他文件通过后仍提示未重跑的失败文件', () => {
    const output: string[] = [];
    const module = (id: string, state: 'passed' | 'failed') =>
      ({
        moduleId: id,
        relativeModuleId: id,
        state: () => state,
        ok: () => state === 'passed',
        errors: () => [],
        children: { allTests: () => [], allSuites: () => [] },
      }) as unknown as TestModule;
    const failed = module('failed.test.ts', 'failed');
    const passed = module('passed.test.ts', 'passed');
    const reporter = new ChineseReporter();
    const log = (...parts: string[]) => output.push(parts.join(' '));
    reporter.onInit({
      config: {},
      logger: { log, error: log },
      state: {
        getTestModules: () => [failed, passed],
        getUnhandledErrors: () => [],
      },
    } as unknown as Vitest);
    reporter.onWatcherRerun(['passed.test.ts']);
    reporter.onTestRunStart([]);
    reporter.onTestRunEnd([passed], [], 'passed');
    reporter.onWatcherStart();
    expect(output.join('\n')).toContain('测试结果：失败');
    expect(output.join('\n')).toContain('测试文件：通过 1，失败 1，共 2');
    expect(output.join('\n')).toContain('仍有 1 个文件失败');
  });

  it('区分通过、跳过和待实现，并保留原始日志', () => {
    const result = run({
      'status.test.ts': `
        test('通过用例', () => {
          console.log('raw stdout');
          console.error('raw stderr');
          expect(1).toBe(1);
        });
        test.skip('跳过用例', () => {});
        test.todo('待实现用例');
      `,
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('测试结果：通过');
    expect(result.output).toContain('测试文件：通过 1，共 1');
    expect(result.output).toContain('测试用例：通过 1，跳过 1，待实现 1，共 3');
    expect(result.output).toContain('[标准输出]');
    expect(result.output).toContain('raw stdout');
    expect(result.output).toContain('[标准错误]');
    expect(result.output).toContain('raw stderr');
  }, 40_000);

  it('失败、分组钩子异常和收集错误保留诊断及非零退出码', () => {
    const result = run({
      'failure.test.ts': `
        test('断言失败', () => expect({ value: 'actual' }).toEqual({ value: 'expected' }));
        describe('钩子分组', () => {
          beforeAll(() => { throw new Error('original hook error'); });
          test('无法执行', () => {});
        });
      `,
      'collection.test.ts': `throw new Error('original collection error');`,
    });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('测试结果：失败');
    expect(result.output).toContain('用例失败：failure.test.ts > 断言失败');
    expect(result.output).toContain('actual');
    expect(result.output).toContain('expected');
    expect(result.output).toContain('分组错误：failure.test.ts > 钩子分组');
    expect(result.output).toContain('original hook error');
    expect(result.output).toContain('文件错误：collection.test.ts');
    expect(result.output).toContain('original collection error');
  }, 40_000);

  it('用例通过时仍展示未处理错误并让运行失败', () => {
    const result = run({
      'unhandled.test.ts': `
        test('异步未处理异常', async () => {
          setTimeout(() => { throw new Error('original unhandled error'); }, 0);
          await new Promise(resolve => setTimeout(resolve, 50));
        });
      `,
    });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('测试结果：失败');
    expect(result.output).toContain('未处理的错误：');
    expect(result.output).toContain('original unhandled error');
    expect(result.output).toContain('未处理错误：1');
  }, 40_000);

  it('未找到测试文件时不会误报通过', () => {
    const result = run({});
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('未找到匹配的测试文件');
    expect(result.output).toContain('测试结果：失败');
  }, 40_000);

  it('仅显示失败用例日志时仍保留日志来源堆栈', () => {
    const result = run(
      {
        'pass.test.ts': `test('通过用例', () => console.log('hidden passed log'));`,
        'fail.test.ts': `test('失败用例', () => { console.log('visible failed log'); expect(1).toBe(2); });`,
      },
      ['--silent=passed-only', '--printConsoleTrace']
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).not.toContain('hidden passed log');
    expect(result.output).toContain('visible failed log');
    expect(result.output).toContain('日志来源：');
    expect(result.output).toContain('fail.test.ts:');
  }, 40_000);
});
