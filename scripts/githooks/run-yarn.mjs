// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveYarnCommand } from './yarn-command.mjs';
export { resolveYarnCommand } from './yarn-command.mjs';

/**
 * 同步运行 Yarn，返回 spawnSync 的结果（status、signal、error、stdout、stderr）。
 * 默认继承标准输入输出；调用方可设置 cwd、env、stdio、encoding、timeout、maxBuffer。
 * 解析错误也返回 error，绝不在进程执行失败后换用另一个包管理器重试。
 */
export function runYarn(args, options = {}) {
  try {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw Object.assign(new Error('Yarn 参数必须是字符串数组。'), {
        code: 'EINVAL',
      });
    }
    const { cwd = process.cwd(), env = process.env } = options;
    const invocation = resolveYarnCommand({ cwd, env });
    return spawnSync(invocation.command, [...invocation.args, ...args], {
      cwd,
      env,
      stdio: options.stdio ?? 'inherit',
      encoding: options.encoding,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      windowsHide: true,
      shell: false,
    });
  } catch (error) {
    return {
      pid: 0,
      output: null,
      stdout: null,
      stderr: null,
      status: null,
      signal: null,
      error,
    };
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = runYarn(process.argv.slice(2));
  if (result.error) {
    process.stderr.write(`Yarn 启动失败：${result.error.message}\n`);
    process.exitCode = result.error.code === 'ENOENT' ? 127 : 1;
  } else if (result.signal) {
    // 在 POSIX 中保留终止信号；不支持该信号的平台至少返回失败。
    process.exitCode = 1;
    try {
      process.kill(process.pid, result.signal);
    } catch {
      // exitCode 已设置为失败。
    }
  } else {
    process.exitCode = result.status ?? 1;
  }
}
