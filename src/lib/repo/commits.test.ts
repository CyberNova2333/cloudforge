// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { agentOfRepo, groupByDay, trustedAgent } from './commits';

const c = (hash: string, committedAt: number) => ({ hash, committedAt });

describe('groupByDay：按日期分组', () => {
  it('按输入顺序将同一天的相邻提交分组', () => {
    const day = (t: number) => (t < 100 ? 'one' : 'two');
    expect(
      groupByDay([c('a', 1), c('b', 2), c('c', 200), c('d', 3)], day)
    ).toEqual([
      { day: 'one', commits: [c('a', 1), c('b', 2)] },
      { day: 'two', commits: [c('c', 200)] },
      { day: 'one', commits: [c('d', 3)] },
    ]);
  });
  it('没有提交时为空', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('agentOfRepo：仓库所属代理', () => {
  const agents = [
    { id: 'u1', username: 'dataagent', name: 'Data' },
    { id: 'u2', username: 'securityagent', name: 'Security' },
  ];
  it('返回拥有 <handle>/<handle> 仓库的代理', () => {
    expect(agentOfRepo('dataagent', 'dataagent', agents)?.id).toBe('u1');
    expect(agentOfRepo('DataAgent', 'dataagent', agents)?.id).toBe('u1');
  });
  it('其他仓库均返回 null', () => {
    expect(agentOfRepo('mahmoud', 'dataagent', agents)).toBeNull();
    expect(agentOfRepo('dataagent', 'notes', agents)).toBeNull();
    expect(agentOfRepo('mahmoud', 'mahmoud', agents)).toBeNull();
    expect(agentOfRepo('dataagent', 'dataagent', undefined)).toBeNull();
  });
});

describe('trustedAgent：可信代理', () => {
  const data = { id: 'u1', username: 'dataagent', name: 'Data' };
  it('仅在代理自己的仓库中将其邮箱信任为该代理', () => {
    expect(trustedAgent('u1@agents.invalid', data)).toBe(data);
    expect(trustedAgent(' U1@Agents.Invalid ', data)).toBe(data);
  });
  it('不信任该仓库中其他代理的邮箱', () => {
    expect(trustedAgent('u2@agents.invalid', data)).toBeNull();
  });
  it('非代理仓库中不信任任何代理邮箱', () => {
    // Anyone who can push can write an agent's address into a commit, and agent ids are public.
    expect(trustedAgent('u1@agents.invalid', null)).toBeNull();
    expect(trustedAgent('u1@agents.invalid', undefined)).toBeNull();
  });
  it('普通用户返回 null', () => {
    expect(trustedAgent('u1@example.com', data)).toBeNull();
  });
});
