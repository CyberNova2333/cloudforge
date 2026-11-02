// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { spawn } from 'node:child_process';
import { resolveYarnCommand } from '../../githooks/yarn-command.mjs';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  input?: string;
  env?: Record<string, string>;
  cwd?: string;
}

export interface Runner {
  run(cmd: string, args: string[], opts?: RunOptions): Promise<RunResult>;
}

/** Runs real processes, never through a shell. */
export const processRunner: Runner = {
  run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const env = opts.env ? { ...process.env, ...opts.env } : process.env;
      const invocation =
        cmd === 'yarn'
          ? resolveYarnCommand({ cwd: opts.cwd, env })
          : { command: cmd, args: [] };
      const child = spawn(invocation.command, [...invocation.args, ...args], {
        shell: false,
        windowsHide: true,
        cwd: opts.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input ?? '');
    });
  },
};

/** `runner` with `env` added to every command's environment (a command's own env wins). */
export function withEnv(runner: Runner, env: Record<string, string>): Runner {
  return {
    run(cmd, args, opts = {}) {
      return runner.run(cmd, args, { ...opts, env: { ...env, ...opts.env } });
    },
  };
}
