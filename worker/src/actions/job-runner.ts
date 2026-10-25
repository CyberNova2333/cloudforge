// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { DurableObject } from 'cloudflare:workers';
import {
  mask,
  maskValues,
  parseKeyValueFile,
  parsePathFile,
  workflowCommands,
} from './commands';
import type { InstanceType } from './plan';

export interface StepRequest {
  number: number;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  /** Values masked as *** in the log. */
  masks: string[];
}

export interface StepResult {
  exitCode: number;
  timedOut: boolean;
  log: string;
  outputs: Record<string, string>;
  envAdds: Record<string, string>;
  pathAdds: string[];
  /** Job-wide masks, including dynamically registered values. Executor persists these only encrypted. */
  masks?: string[];
  /** What the step saved to $GITHUB_STATE: its post step gets each as STATE_<name>. Absent from older runners. */
  state?: Record<string, string>;
  /** Set when the container stopped under the step (e.g. a deploy), as opposed to the step failing. */
  interrupted?: string;
}

/** Executor-facing RPC surface of the Durable Object. */
export interface JobRunnerApi {
  boot(instance: InstanceType, maxMs: number): Promise<{ ms: number }>;
  runStep(req: StepRequest): Promise<StepResult>;
  destroy(): Promise<void>;
}

export const WORKSPACE = '/workspace';
const STATE_DIR = '/tmp/_cloudforge';
/** Per-step log cap; the start is dropped so the end (where failures are) survives. */
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const BOOT_TIMEOUT_MS = 3 * 60_000;

function capped(text: string): string {
  if (text.length <= MAX_LOG_BYTES) return text;
  return (
    `[log truncated: showing the last ${MAX_LOG_BYTES / 1024 / 1024} MB]\n` +
    text.slice(-MAX_LOG_BYTES)
  );
}

/**
 * One job's container (`durable_object` scheduling: instance type picked at runtime). State is
 * only the running step's output (for live logs) and an alarm that destroys orphaned containers.
 */
export class JobRunner
  extends DurableObject<CloudflareBindings>
  implements JobRunnerApi
{
  private liveStep: { number: number; text: string; masks: string[] } | null =
    null;
  private masks: string[] = [];
  private registeredMasks: string[] = [];

  private get container() {
    const c = this.ctx.container;
    if (!c) throw new Error('The JobRunner container is not configured');
    return c;
  }

  async boot(instance: InstanceType, maxMs: number): Promise<{ ms: number }> {
    const t = Date.now();
    // Orphan hard stop: job timeout plus a margin.
    await this.ctx.storage.setAlarm(Date.now() + maxMs + 10 * 60_000);
    if (!this.container.running) {
      this.container.start({
        image: this.container.images.runner,
        instance,
        entrypoint: ['sleep', 'infinity'],
        enableInternet: true,
      });
    }
    // start() returns before the container accepts commands; probe until exec works.
    for (;;) {
      try {
        const p = await this.container.exec([
          'mkdir',
          '-p',
          WORKSPACE,
          STATE_DIR,
        ]);
        if ((await p.exitCode) === 0) break;
      } catch {
        // not ready yet
      }
      if (Date.now() - t > BOOT_TIMEOUT_MS)
        throw new Error('The runner did not start within 3 minutes');
      await new Promise((r) => setTimeout(r, 250));
    }
    // The microVM leaves `/` owned by an unmapped user, which tools like @swc/core reject.
    // Best effort: chown it to root.
    await this.container
      .exec(['chown', '0:0', '/'])
      .then((p) => p.exitCode)
      .catch((e) => console.warn('[actions] chown / failed', e));
    return { ms: Date.now() - t };
  }

  async runStep(req: StepRequest): Promise<StepResult> {
    if (!this.ctx.container?.running)
      throw new Error('The runner container is no longer running');
    const files = {
      GITHUB_ENV: `${STATE_DIR}/env_${req.number}`,
      GITHUB_OUTPUT: `${STATE_DIR}/output_${req.number}`,
      GITHUB_PATH: `${STATE_DIR}/path_${req.number}`,
      GITHUB_STEP_SUMMARY: `${STATE_DIR}/summary_${req.number}`,
      GITHUB_STATE: `${STATE_DIR}/state_${req.number}`,
    };
    // Emptied, not just created: a composite action's steps share the step's number, and each must only see
    // (and report) what it wrote itself.
    await (
      await this.container.exec([
        'sh',
        '-c',
        'for f in "$@"; do : > "$f"; done',
        'sh',
        ...Object.values(files),
      ])
    ).exitCode;
    await (
      await this.container.exec(['mkdir', '-p', req.cwd])
    ).exitCode;

    this.masks = [...new Set([...this.masks, ...req.masks])];
    // destroy() can interleave while exec/stdout awaits. Keep this step's masks
    // until its final output and diagnostic have been returned, even after the
    // runner resets its job-wide state for destruction.
    const masks = this.masks;
    const registeredMasks = this.registeredMasks;
    const live = { number: req.number, text: '', masks };
    this.liveStep = live;
    let pending = '';
    let droppingLine = false;
    const append = (line: string) => {
      const shown = workflowCommands(line);
      for (const value of shown.masks)
        for (const m of maskValues(value)) {
          if (!masks.includes(m)) masks.push(m);
          if (!registeredMasks.includes(m)) registeredMasks.push(m);
        }
      // Parse commands before truncating. Mask before truncating as well, so a
      // value crossing the retained log boundary cannot leak a suffix.
      live.text += mask(shown.text, masks);
      if (live.text.length > MAX_LOG_BYTES * 1.25)
        live.text = capped(live.text);
    };
    let timedOut = false;
    let exitCode = 1;
    let interrupted: string | undefined;
    const started = Date.now();
    // GNU timeout exits 124, or 137 once --kill-after sends SIGKILL. A command can exit with either itself, and the
    // OOM killer's SIGKILL is 137 too: only an exit at or past the deadline is the timeout.
    const ranOut = (code: number) =>
      (code === 124 || code === 137) && Date.now() - started >= req.timeoutMs;
    try {
      // Cloudflare exec signals only its direct process. GNU timeout signals
      // the command's process group and escalates to SIGKILL after five seconds.
      const proc = await this.container.exec(
        [
          '/usr/bin/timeout',
          '--kill-after=5s',
          `${Math.max(1, req.timeoutMs) / 1000}s`,
          ...req.argv,
        ],
        {
          cwd: req.cwd,
          env: { ...req.env, ...files },
          stderr: 'combined',
        }
      );
      if (proc.stdout) {
        const reader = proc.stdout
          .pipeThrough(new TextDecoderStream())
          .getReader();
        const drain = (async () => {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += value;
            const newline = pending.lastIndexOf('\n');
            if (newline >= 0) {
              const complete = pending.slice(0, newline + 1);
              append(
                droppingLine
                  ? complete.slice(complete.indexOf('\n') + 1)
                  : complete
              );
              droppingLine = false;
              pending = pending.slice(newline + 1);
            }
            // Keep incomplete output out of live logs; a mask/secret may span
            // transport chunks. Bound exceptionally long, newline-free output.
            if (pending.length > MAX_LOG_BYTES) {
              pending = '';
              droppingLine = true;
              append('[log truncated: an oversized line was omitted]\n');
            }
          }
        })().catch((error: unknown) => ({ error }));
        exitCode = await proc.exitCode;
        timedOut = ranOut(exitCode);
        // A completed command may have launched a daemon holding stdout open.
        // Drain its buffered output, then close our reader rather than waiting
        // indefinitely on that daemon. No signal is sent to an exited process.
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          drain,
          new Promise<void>((r) => {
            timer = setTimeout(r, 100);
          }),
        ]);
        if (timer) clearTimeout(timer);
        await reader.cancel().catch(() => {});
        const drained = await drain;
        if (drained) throw drained.error;
      } else {
        exitCode = await proc.exitCode;
        timedOut = ranOut(exitCode);
      }
      if (!droppingLine) append(pending);
    } catch (e) {
      // A successful process exit cannot make a failed output read a successful step.
      exitCode = 1;
      const message = e instanceof Error ? e.message : String(e);
      if (!timedOut) live.text += `\n${mask(message, masks)}\n`;
      if (!timedOut && !this.ctx.container?.running)
        interrupted = mask(message, masks);
    }
    // A non-zero exit is the step's own failure unless the container itself went away.
    if (
      !interrupted &&
      !timedOut &&
      exitCode !== 0 &&
      !this.ctx.container?.running
    )
      interrupted = `The runner container stopped while the step was running (exit code ${exitCode})`;
    if (timedOut) {
      exitCode = 1;
      live.text += `\nThe step exceeded its timeout of ${Math.round(req.timeoutMs / 60_000)} minutes and was stopped.\n`;
    }

    // Command files, NUL-separated.
    let envAdds: Record<string, string> = {};
    let outputs: Record<string, string> = {};
    let pathAdds: string[] = [];
    let state: Record<string, string> = {};
    try {
      const p = await this.container.exec([
        'sh',
        '-c',
        `cat "$1"; printf '\\0'; cat "$2"; printf '\\0'; cat "$3"; printf '\\0'; cat "$4"`,
        'sh',
        files.GITHUB_ENV,
        files.GITHUB_OUTPUT,
        files.GITHUB_PATH,
        files.GITHUB_STATE,
      ]);
      const out = await p.output();
      const [env = '', output = '', path = '', saved = ''] = new TextDecoder()
        .decode(out.stdout)
        .split('\0');
      envAdds = parseKeyValueFile(env);
      outputs = parseKeyValueFile(output);
      pathAdds = parsePathFile(path);
      state = parseKeyValueFile(saved);
    } catch {
      // Container is gone (e.g. timed out).
    }
    this.liveStep = null;
    return {
      exitCode,
      timedOut,
      log: capped(mask(live.text, masks)),
      masks: [...registeredMasks],
      outputs,
      envAdds,
      pathAdds,
      state,
      ...(interrupted ? { interrupted } : {}),
    };
  }

  /** Output so far of the running step, for live logs. */
  async live(stepNumber: number): Promise<string | null> {
    const s = this.liveStep;
    if (!s || s.number !== stepNumber) return null;
    return capped(mask(s.text, s.masks));
  }

  async destroy(): Promise<void> {
    this.liveStep = null;
    this.masks = [];
    this.registeredMasks = [];
    // Keep the hard-stop fallback if the platform cannot confirm container destruction.
    if (this.ctx.container?.running) await this.container.destroy();
    await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    if (this.ctx.container?.running) await this.container.destroy();
  }
}
