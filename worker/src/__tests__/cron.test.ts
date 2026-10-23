// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it, vi } from 'vitest';
import example from '../../../wrangler.jsonc.example?raw';
import ci from '../../../wrangler.jsonc.ci?raw';
import {
  ACTIONS_RETENTION_CRON,
  CRON_JOBS,
  USAGE_SYNC_CRON,
  runScheduled,
} from '../cron';
import { makeEnv } from './helpers/app';

const retentionStatus = (t: ReturnType<typeof makeEnv>) =>
  t.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM instance_settings WHERE key = 'actions.retention_status'"
  ).first<{ n: number }>();

describe('定时任务', () => {
  it('仅运行触发的 cron 对应任务', async () => {
    const t = makeEnv();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await runScheduled({ cron: USAGE_SYNC_CRON }, t.env).catch(() => {});
    expect((await retentionStatus(t))?.n).toBe(0);
    await runScheduled({ cron: ACTIONS_RETENTION_CRON }, t.env);
    expect((await retentionStatus(t))?.n).toBe(1);
    vi.restoreAllMocks();
  });

  it('在各模板的每个环境中，用一个 triggers.crons 列出所有任务', () => {
    for (const [name, text] of [
      ['wrangler.jsonc.example', example],
      ['wrangler.jsonc.ci', ci],
    ]) {
      const lines = text.split('\n').filter((l) => l.includes('"triggers"'));
      // One per environment: the top level, plus env.dev in the example.
      expect(lines.length, name).toBe(name.endsWith('example') ? 2 : 1);
      for (const line of lines)
        for (const cron of Object.keys(CRON_JOBS))
          expect(line, `${name}: ${cron}`).toContain(`"${cron}"`);
    }
  });
});
