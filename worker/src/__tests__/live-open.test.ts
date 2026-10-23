// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { settle } from './helpers/app';
import { connect, crewRepo } from './helpers/crew';

describe('通过 MCP 创建拉取请求', () => {
  it('通知仓库和审批频道', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin);
    await s.branch('feature');
    const pings: string[] = [];
    (s.t.env as unknown as { LIVE: unknown }).LIVE = {
      getByName: () => ({
        publish: async (channel: string) => void pings.push(channel),
      }),
    };
    await s.mcp(access_token, 'feature');
    await settle(s.t);
    expect(pings).toContain(`repo:${s.repoId}`);
    expect(pings).toContain('approvals');
  });
});
