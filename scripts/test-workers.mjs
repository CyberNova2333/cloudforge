// Run Worker tests with their raw runtime diagnostics included in the exit status.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { resolveYarnCommand } from './githooks/run-yarn.mjs';

// workerd can print these outside Vitest's reporter, even after its passing summary.
// Match complete diagnostic prefixes, not arbitrary mentions in test names or logs.
const TEARDOWN =
  /^uncaught exception; (?:source = Uncaught \(in promise\); stack = |exception = ).*EnvironmentTeardownError: \[vitest-worker\]: Closing rpc while "(?:resolve|onUserConsoleLog)" was pending/;
const WRONG_CONTEXT =
  /^Error sending to pool inside runner: Error: Cannot perform I\/O on behalf of a different Durable Object\..*\(I\/O type: SpanParent\)/;
const PREFIX_LIMIT = 4096;

/** Keep only a bounded line prefix; retain chunk boundaries and the final unterminated line. */
export function runtimeDiagnosticScanner() {
  const decoder = new StringDecoder('utf8');
  let prefix = '';
  let diagnostic;
  const inspect = () => {
    if (diagnostic) return;
    const line = stripVTControlCharacters(prefix);
    if (TEARDOWN.test(line)) diagnostic = 'Worker RPC 在收尾时仍有待完成的调用';
    else if (WRONG_CONTEXT.test(line))
      diagnostic = 'Worker RPC 跨 Durable Object 使用了 SpanParent';
  };
  const consume = (text) => {
    let start = 0;
    for (;;) {
      const end = text.indexOf('\n', start);
      const length = end === -1 ? text.length : end;
      prefix += text.slice(
        start,
        Math.min(length, start + PREFIX_LIMIT - prefix.length)
      );
      if (end === -1) break;
      inspect();
      prefix = '';
      start = end + 1;
    }
  };
  return {
    write(chunk) {
      consume(decoder.write(chunk));
    },
    end() {
      consume(decoder.end());
      inspect();
      return diagnostic;
    },
  };
}

/** Stream output unchanged and inspect it until close (which follows stdout/stderr EOF). */
export async function runCheckedCommand(
  command,
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {}
) {
  const scans = [runtimeDiagnosticScanner(), runtimeDiagnosticScanner()];
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolveResult({ code: error.code === 'ENOENT' ? 127 : 1, error });
      return;
    }
    let error;
    let requestedSignal;
    const forwardSignal = (signal) => {
      requestedSignal ??= signal;
      child.kill(signal);
    };
    const onInterrupt = () => forwardSignal('SIGINT');
    const onTerminate = () => forwardSignal('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    for (const [index, [source, target]] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ].entries()) {
      source.on('data', (chunk) => scans[index].write(chunk));
      // pipe provides backpressure without retaining the full test log in memory.
      source.pipe(target, { end: false });
    }
    child.once('error', (caught) => {
      error = caught;
    });
    child.once('close', (code, signal) => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      const diagnostic = scans.map((scanner) => scanner.end()).find(Boolean);
      resolveResult({
        code: error
          ? error.code === 'ENOENT'
            ? 127
            : 1
          : code === 0 && diagnostic
            ? 1
            : (code ?? 1),
        signal: signal ?? requestedSignal,
        error,
        diagnostic,
      });
    });
  });
}

export async function runWorkerTests(args, options = {}) {
  try {
    const env = options.env ?? process.env;
    let invocation;
    // Yarn 1 injects a temporary yarn.cmd into PATH while running package scripts.
    // Use the current Yarn's own JS entry rather than trying to parse that wrapper.
    if (/^yarn\//.test(env.npm_config_user_agent ?? '') && env.npm_execpath) {
      const entry = env.npm_execpath;
      if (
        !isAbsolute(entry) ||
        !['.js', '.mjs', '.cjs'].includes(extname(entry)) ||
        !statSync(entry).isFile()
      ) {
        throw new Error('Yarn 生命周期没有提供可用的 JavaScript 入口。');
      }
      invocation = { command: process.execPath, args: [entry] };
    } else {
      invocation = resolveYarnCommand(options);
    }
    return await runCheckedCommand(
      invocation.command,
      [
        ...invocation.args,
        'vitest',
        'run',
        '--config',
        'worker/vitest.config.ts',
        ...args,
      ],
      options
    );
  } catch (error) {
    return { code: error.code === 'ENOENT' ? 127 : 1, error };
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await runWorkerTests(process.argv.slice(2));
  if (result.error)
    process.stderr.write(`Worker 测试启动失败：${result.error.message}\n`);
  if (result.diagnostic)
    process.stderr.write(
      `\nWorker 测试验收失败：${result.diagnostic}。上方保留了原始运行器输出。\n`
    );
  process.exitCode = result.code;
  if (result.signal) {
    process.exitCode = 1;
    try {
      process.kill(process.pid, result.signal);
    } catch {
      // Platforms without this signal still return failure.
    }
  }
}
