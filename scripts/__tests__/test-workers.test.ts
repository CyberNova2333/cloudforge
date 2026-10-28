import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error: plain JavaScript module, no types
import {
  runCheckedCommand,
  runWorkerTests,
  runtimeDiagnosticScanner,
} from '../test-workers.mjs';

const diagnostic =
  'uncaught exception; source = Uncaught (in promise); stack = EnvironmentTeardownError: [vitest-worker]: Closing rpc while "resolve" was pending';
const crossContext =
  'Error sending to pool inside runner: Error: Cannot perform I/O on behalf of a different Durable Object. I/O objects cannot cross contexts. (I/O type: SpanParent)';

function output() {
  let text = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, done) {
        text += chunk;
        done();
      },
    }),
    text: () => text,
  };
}

async function run(source: string) {
  const stdout = output();
  const stderr = output();
  const result = await runCheckedCommand(
    process.execPath,
    ['--input-type=module', '-e', source],
    {
      stdout: stdout.stream,
      stderr: stderr.stream,
    }
  );
  return { ...result, stdout: stdout.text(), stderr: stderr.text() };
}

describe('Worker 测试运行器的退出状态', () => {
  it('在 Yarn 生命周期中复用当前入口，逐项传递参数且保留验证失败退出码', async () => {
    const base = resolve(tmpdir(), 'cloudforge-worker-test-');
    const dir = mkdtempSync(base);
    try {
      const entry = join(dir, 'yarn.mjs');
      writeFileSync(
        entry,
        `process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write(${JSON.stringify(diagnostic)});`
      );
      const stdout = output();
      const stderr = output();
      const args = [
        '文件 with spaces.test.ts',
        '& not a command',
        '--shard=1/2',
      ];
      const result = await runWorkerTests(args, {
        env: {
          ...process.env,
          npm_config_user_agent: 'yarn/1.22.22',
          npm_execpath: entry,
        },
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      expect(result.code).toBe(1);
      expect(JSON.parse(stdout.text())).toEqual([
        'vitest',
        'run',
        '--config',
        'worker/vitest.config.ts',
        ...args,
      ]);
      expect(stderr.text()).toBe(diagnostic);
    } finally {
      if (!resolve(dir).startsWith(base))
        throw new Error('测试临时目录超出预期范围');
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('通过汇总后出现的原始收尾异常使退出 0 的子进程验收失败，输出保持原样', async () => {
    const result = await run(`
      process.stdout.write('Test Files 12 passed (12)\\n');
      setTimeout(() => process.stderr.write(${JSON.stringify(diagnostic)}), 5);
    `);
    expect(result.code).toBe(1);
    expect(result.diagnostic).toContain('RPC');
    expect(result.stdout).toBe('Test Files 12 passed (12)\n');
    expect(result.stderr).toBe(diagnostic);
  });

  it('检查两个输出流，同时保留子进程原有的非零退出码', async () => {
    const result = await run(
      `process.stdout.write(${JSON.stringify(crossContext)}); process.exitCode = 17;`
    );
    expect(result.code).toBe(17);
    expect(result.diagnostic).toContain('SpanParent');
    expect(result.stdout).toBe(crossContext);
  });

  it('正常日志和包含错误名称的普通用例说明不会被误判', async () => {
    const text =
      '✓ EnvironmentTeardownError 回归\n模拟 Closing rpc while "resolve" was pending\n示例：' +
      diagnostic +
      '\n';
    const result = await run(
      `process.stdout.write(${JSON.stringify(text)}); process.stderr.write('普通警告\\n');`
    );
    expect(result.code).toBe(0);
    expect(result.diagnostic).toBeUndefined();
    expect(result.stdout).toBe(text);
    expect(result.stderr).toBe('普通警告\n');
  });

  it('启动失败按失败返回', async () => {
    const result = await runCheckedCommand(
      'cloudforge-nonexistent-runtime-test-command',
      [],
      {
        stdout: output().stream,
        stderr: output().stream,
      }
    );
    expect(result.code).toBe(127);
    expect(result.error.code).toBe('ENOENT');
  });

  it('保留子进程的终止信号', async () => {
    const source = `process.kill(process.pid, 'SIGTERM');`;
    // Windows reports self-termination as a numeric status; POSIX exposes SIGTERM.
    const native = spawnSync(process.execPath, ['-e', source]);
    expect(native.error).toBeUndefined();
    const result = await run(source);
    expect(result.code).not.toBe(0);
    expect(result.signal ?? null).toBe(native.signal);
    if (native.status !== null) expect(result.code).toBe(native.status);
  });

  it('处理跨 chunk 的 UTF-8、ANSI、诊断标记以及没有换行的末行', () => {
    const scan = runtimeDiagnosticScanner();
    const bytes = Buffer.from(
      '中文普通日志\r\n\u001b[31m' + diagnostic + '\u001b[0m'
    );
    for (const byte of bytes) scan.write(Buffer.from([byte]));
    expect(scan.end()).toContain('RPC');
  });

  it('超长普通行不匹配行尾的示例，且不会丢失下一行的真实错误', () => {
    const scan = runtimeDiagnosticScanner();
    scan.write(Buffer.from('普通日志'.repeat(100_000) + diagnostic));
    scan.write(Buffer.from('\n' + crossContext));
    expect(scan.end()).toContain('SpanParent');
  });

  it('识别 workerd 二次报告和 onUserConsoleLog 的相同收尾竞争', () => {
    const scan = runtimeDiagnosticScanner();
    scan.write(
      Buffer.from(
        'uncaught exception; exception = workerd/jsg/value.h:1477: failed: jsg.Error: EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending\n'
      )
    );
    expect(scan.end()).toContain('RPC');
  });
});
