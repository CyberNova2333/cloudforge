// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_KINDS,
  actorRole,
  agentKindLabel,
  formatCost,
  formatTokens,
  isAgentKind,
  modelsOf,
  parseActionsView,
  runActor,
  runAvatarStatus,
  runOutcome,
  runStatusLook,
} from './agentRuns';
import { avatarState } from './agentLook';

describe('运行类型', () => {
  it('按页面顺序命名服务端记录的六种类型', () => {
    expect(AGENT_RUN_KINDS.map((k) => k.kind)).toEqual([
      'review',
      'rebase',
      'conflict_resolution',
      'stack_discovery',
      'sweep',
      'learning',
    ]);
    expect(agentKindLabel('stack_discovery')).toBe('Stack discovery');
    expect(agentKindLabel('conflict_resolution')).toBe(
      'Conflict resolution (squash-era)'
    );
  });
  it('仅从 URL 中识别有效类型', () => {
    expect(isAgentKind('learning')).toBe(true);
    expect(isAgentKind('all')).toBe(false);
    expect(isAgentKind(null)).toBe(false);
    expect(isAgentKind('')).toBe(false);
  });
});

describe('parseActionsView：解析自动化视图', () => {
  const view = (qs: string) => parseActionsView(new URLSearchParams(qs));
  it('默认显示工作流运行，并从 URL 读取筛选和页码', () => {
    expect(view('')).toEqual({ mode: 'workflows', workflow: '', page: 1 });
    expect(view('workflow=.github/workflows/ci.yml&page=3')).toEqual({
      mode: 'workflows',
      workflow: '.github/workflows/ci.yml',
      page: 3,
    });
  });
  it('无效页码限制为 1', () => {
    for (const qs of ['page=0', 'page=-4', 'page=abc'])
      expect(view(qs)).toMatchObject({ mode: 'workflows', page: 1 });
  });
  it('打开特定类型或全部代理运行', () => {
    expect(view('agent=review')).toEqual({ mode: 'agents', kind: 'review' });
    expect(view('agent=all')).toEqual({ mode: 'agents', kind: null });
  });
  it('未知代理类型仍显示工作流列表', () => {
    expect(view('agent=bogus').mode).toBe('workflows');
  });
});

describe('runActor：工作执行者', () => {
  it('Clef 负责评审路由和拉取请求堆叠', () => {
    expect(
      runActor({ kind: 'review', title: 'Review of 1a2b3c4' })
    ).toMatchObject({ id: 'clef', handle: 'clef', builtin: true });
    expect(
      runActor({ kind: 'stack_discovery', title: 'Stack discovery for #9' })
    ).toMatchObject({ id: 'clef', builtin: true });
    expect(
      runActor({ kind: 'sweep', title: 'Sweep after a push to main' })
    ).toMatchObject({ id: 'clef' });
  });
  it('Fixer 负责变基和解决冲突', () => {
    expect(
      runActor({ kind: 'rebase', title: 'Rebase #4 onto main' })
    ).toMatchObject({ id: 'fixer', handle: 'fixer', builtin: true });
    expect(
      runActor({
        kind: 'conflict_resolution',
        title: 'Resolve conflicts with main',
      })
    ).toMatchObject({ id: 'fixer' });
  });
  it('评审代理负责评审和学习，并在运行标题中显示名称', () => {
    expect(
      runActor({ kind: 'review', title: 'Review by @securityagent of 1a2b3c4' })
    ).toEqual({
      id: 'reviewer',
      handle: 'securityagent',
      builtin: false,
    });
    expect(
      runActor({ kind: 'learning', title: '@data-agent learns from #67' })
    ).toEqual({ id: 'reviewer', handle: 'data-agent', builtin: false });
  });
  it('学习运行未指明代理时返回 null', () => {
    expect(runActor({ kind: 'learning', title: 'Something else' })).toBeNull();
  });
});

describe('actorRole：执行者角色', () => {
  it('用易懂的文字说明各执行者的工作', () => {
    expect(actorRole({ kind: 'review', title: 'Review of 1a2b3c4' })).toBe(
      'Decides which reviewers to ask'
    );
    expect(
      actorRole({
        kind: 'review',
        title: 'Review by @securityagent of 1a2b3c4',
      })
    ).toBe('Reviews the change');
    expect(actorRole({ kind: 'rebase', title: 'Rebase #4 onto main' })).toBe(
      'Rebases the branch'
    );
    expect(
      actorRole({ kind: 'conflict_resolution', title: 'Resolve conflicts' })
    ).toBe('Resolves conflicts');
    expect(
      actorRole({ kind: 'stack_discovery', title: 'Stack discovery for #9' })
    ).toBe('Works out how pull requests fit together');
    expect(actorRole({ kind: 'sweep', title: 'Sweep after a push' })).toBe(
      'Re-checks open pull requests'
    );
    expect(
      actorRole({ kind: 'learning', title: '@data-agent learns from #67' })
    ).toBe('Learns from dismissed requests');
  });
});

describe('运行状态', () => {
  it('运行中显示工作头像，失败显示失败表情，完成显示通过', () => {
    expect(avatarState(runAvatarStatus('running'))).toBe('startWaiting');
    expect(avatarState(runAvatarStatus('failed'))).toBe('error');
    expect(avatarState(runAvatarStatus('succeeded'))).toBe('success');
  });
  it('状态标签始终包含文字', () => {
    expect(runStatusLook('running')).toEqual({
      tone: 'info',
      label: 'Running',
    });
    expect(runStatusLook('succeeded')).toEqual({
      tone: 'good',
      label: 'Finished',
    });
    expect(runStatusLook('failed')).toEqual({
      tone: 'critical',
      label: 'Failed',
    });
  });
});

describe('runOutcome：运行结果', () => {
  const step = (over: Partial<Parameters<typeof runOutcome>[1][number]>) => ({
    decision: null,
    error: null,
    ...over,
  });
  it('失败时使用运行错误', () => {
    expect(
      runOutcome({ status: 'failed', error: 'Model timed out' }, [
        step({ decision: 'earlier decision' }),
      ])
    ).toBe('Model timed out');
  });
  it('运行没有错误文字时回退到最后一个失败步骤', () => {
    expect(
      runOutcome({ status: 'failed', error: null }, [
        step({}),
        step({ error: 'Push rejected' }),
      ])
    ).toBe('Push rejected');
  });
  it('完成后使用步骤记录的最后一个决定', () => {
    expect(
      runOutcome({ status: 'succeeded', error: null }, [
        step({ decision: 'first' }),
        step({ decision: 'Ordered #77 after #76.' }),
        step({}),
      ])
    ).toBe('Ordered #77 after #76.');
  });
  it('说明没有记录或仍在进行', () => {
    expect(runOutcome({ status: 'succeeded', error: null }, [step({})])).toBe(
      null
    );
    expect(runOutcome({ status: 'running', error: null }, [])).toBe(
      'Still working.'
    );
  });
});

describe('格式化', () => {
  it('美元金额保留足够小数位以显示不足一美分的金额', () => {
    expect(formatCost(null)).toBe('');
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(0.00001)).toBe('<$0.0001');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(0.1234)).toBe('$0.123');
    expect(formatCost(12.3456)).toBe('$12.35');
  });
  it('对令牌数量进行分组格式化', () => {
    expect(formatTokens(38125)).toBe('38,125');
  });
  it('每个模型仅列出一次，并去掉 Workers AI 前缀', () => {
    expect(
      modelsOf([
        { model: '@cf/zai/glm-5.3' },
        { model: null },
        { model: '@cf/zai/glm-5.3, @cf/meta/clef' },
      ])
    ).toEqual(['zai/glm-5.3', 'meta/clef']);
  });
});
