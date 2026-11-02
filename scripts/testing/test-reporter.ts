import type {
  Reporter,
  SerializedError,
  TestCase,
  TestModule,
  TestRunEndReason,
  TestSpecification,
  Vitest,
} from 'vitest/node';

type State = 'passed' | 'failed' | 'skipped' | 'todo' | 'pending' | 'queued';
type ConsoleLog = Parameters<NonNullable<Reporter['onUserConsoleLog']>>[0];
const labels: Record<State, string> = {
  passed: '通过',
  failed: '失败',
  skipped: '跳过',
  todo: '待实现',
  pending: '未完成',
  queued: '排队中',
};

function count(states: State[]): string {
  const parts = Object.entries(labels).flatMap(([state, label]) => {
    const total = states.filter((value) => value === state).length;
    return total ? [`${label} ${total}`] : [];
  });
  return `${parts.join('，') || '无结果'}，共 ${states.length}`;
}

const testState = (test: TestCase): State =>
  test.options.mode === 'todo' ? 'todo' : test.result().state;

/** 中文展示层；不改写断言、日志内容、堆栈或 Vitest 的退出状态。 */
export default class ChineseReporter implements Reporter {
  private ctx!: Vitest;
  private started = 0;
  private logs: ConsoleLog[] = [];
  private failedUnwatched: TestModule[] = [];

  onInit(ctx: Vitest) {
    this.ctx = ctx;
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>) {
    this.started = performance.now();
    this.logs = [];
    this.ctx.logger.log(
      `\n开始测试：${specifications.length} 个文件（Vitest）`
    );
  }

  onTestModuleEnd(module: TestModule) {
    const state = module.state();
    const symbol = state === 'passed' ? '✓' : state === 'failed' ? '×' : '–';
    const tests = [...module.children.allTests()];
    this.ctx.logger.log(
      `${symbol} ${labels[state]} ${module.relativeModuleId}（${count(tests.map(testState))}）${Math.round(module.diagnostic().duration)} 毫秒`
    );
    for (const test of tests) {
      const result = test.result();
      const diagnostic = test.diagnostic();
      if (result.state === 'failed' || diagnostic?.slow || diagnostic?.flaky) {
        const retry = diagnostic?.retryCount
          ? `，重试 ${diagnostic.retryCount} 次`
          : '';
        this.ctx.logger.log(
          `  ${labels[testState(test)]}：${test.fullName}（${Math.round(diagnostic?.duration ?? 0)} 毫秒${retry}）`
        );
      }
    }
  }

  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    errors: ReadonlyArray<SerializedError>,
    reason: TestRunEndReason
  ) {
    modules = [...this.failedUnwatched, ...modules];
    for (const log of this.logs) {
      const task = log.taskId
        ? this.ctx.state.idMap.get(log.taskId)
        : undefined;
      if (!task || task.result?.state === 'fail') this.printLog(log);
    }
    this.logs = [];
    for (const module of modules) {
      for (const error of module.errors()) {
        this.ctx.logger.error(`\n文件错误：${module.relativeModuleId}`);
        this.ctx.logger.printError(error, { project: module.project });
      }
      for (const suite of module.children.allSuites()) {
        for (const error of suite.errors()) {
          this.ctx.logger.error(
            `\n分组错误：${module.relativeModuleId} > ${suite.fullName}`
          );
          this.ctx.logger.printError(error, { project: suite.project });
        }
      }
      for (const test of module.children.allTests('failed')) {
        this.ctx.logger.error(
          `\n用例失败：${module.relativeModuleId} > ${test.fullName}`
        );
        for (const error of test.result().errors ?? []) {
          this.ctx.logger.printError(error, { project: test.project });
        }
      }
    }
    for (const error of errors) {
      this.ctx.logger.error('\n未处理的错误：');
      this.ctx.logger.printError(error);
    }
    const tests = modules.flatMap((module) => [...module.children.allTests()]);
    if (!modules.length)
      this.ctx.logger.log(
        errors.length ? '本轮没有测试文件完成运行。' : '未找到匹配的测试文件。'
      );
    const outcome =
      reason === 'interrupted'
        ? '已中断'
        : reason === 'failed' ||
            errors.length ||
            modules.some((module) => !module.ok()) ||
            (!modules.length && !this.ctx.config.passWithNoTests)
          ? '失败'
          : '通过';
    this.ctx.logger.log(
      `\n测试结果：${outcome}`,
      `\n测试文件：${count(modules.map((module) => module.state()))}`,
      `\n测试用例：${count(tests.map(testState))}`,
      `\n未处理错误：${errors.length}`,
      `\n总耗时：${((performance.now() - this.started) / 1000).toFixed(2)} 秒\n`
    );
  }

  onUserConsoleLog(log: ConsoleLog) {
    if (this.ctx.config.silent === true) return;
    if (this.ctx.config.silent === 'passed-only') {
      this.logs.push(log);
      return;
    }
    this.printLog(log);
  }

  private printLog(log: ConsoleLog) {
    const task = log.taskId ? this.ctx.state.idMap.get(log.taskId) : undefined;
    const entity = task ? this.ctx.state.getReportedEntity(task) : undefined;
    if (this.ctx.config.onConsoleLog?.(log.content, log.type, entity) === false)
      return;
    const stream = log.type === 'stderr' ? 'error' : 'log';
    this.ctx.logger[stream](
      `[${log.type === 'stderr' ? '标准错误' : '标准输出'}]${task ? ` ${task.name}` : ''}\n${log.content}`
    );
    if (log.origin) this.ctx.logger[stream](`日志来源：\n${log.origin}`);
  }

  onWatcherStart() {
    const failed = this.ctx.state
      .getTestModules()
      .filter((module) => !module.ok());
    const errors = this.ctx.state.getUnhandledErrors();
    if (failed.length || errors.length)
      this.ctx.logger.error(
        `仍有 ${failed.length} 个文件失败、${errors.length} 个未处理错误。`
      );
    this.ctx.logger.log('正在监听文件变化；按 h 查看快捷键，按 q 退出。');
  }

  onWatcherRerun(files: string[]) {
    this.failedUnwatched = this.ctx.state
      .getTestModules()
      .filter((module) => !files.includes(module.moduleId) && !module.ok());
    this.ctx.logger.log(`\n重新测试：${files.length} 个文件`);
  }

  onServerRestart() {
    this.ctx.logger.log('正在重启测试服务……');
  }

  onProcessTimeout() {
    this.ctx.logger.error('测试进程退出超时，请检查未关闭的资源。');
  }
}
