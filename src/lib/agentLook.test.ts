// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  AGENT_PALETTE,
  agentColor,
  agentRoundness,
  agentState,
  avatarScript,
  avatarState,
  STATE_LOOK,
} from './agentLook';

describe('agentColor：代理颜色', () => {
  it('使用代理声明的颜色', () => {
    expect(agentColor('securityagent', '#123456')).toBe('#123456');
    expect(agentColor('someone', '#ABCDEF')).toBe('#ABCDEF');
  });

  it('忽略非十六进制的声明颜色', () => {
    expect(agentColor('securityagent', 'red')).toBe('#2a78d6');
    expect(agentColor('securityagent', 'url(x)')).toBe('#2a78d6');
    expect(agentColor('securityagent', null)).toBe('#2a78d6');
    expect(agentColor('securityagent', '')).toBe('#2a78d6');
  });

  it('为内置代理和预设分配调色板颜色', () => {
    expect(agentColor('clef')).toBe('#e26a17');
    expect(agentColor('fixer')).toBe('#e34948');
    expect(agentColor('securityagent')).toBe('#2a78d6');
    expect(agentColor('dataagent')).toBe('#199e70');
    expect(agentColor('speedagent')).toBe('#c98500');
    expect(agentColor('featureagent')).toBe('#d55181');
    expect(agentColor('featuresagent')).toBe('#d55181');
    expect(agentColor('reliabilityagent')).toBe('#008300');
    expect(agentColor('privacyagent')).toBe('#6b5cc9');
    expect(agentColor('shippingagent')).toBe('#55606e');
  });

  it('接受带 @ 或大写字母的账号名', () => {
    expect(agentColor('@SecurityAgent')).toBe('#2a78d6');
  });

  it('将其他账号名稳定映射到调色板', () => {
    const c = agentColor('billingbot');
    expect(AGENT_PALETTE).toContain(c);
    expect(agentColor('billingbot')).toBe(c);
    const spread = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((h) =>
        agentColor(h + 'bot')
      )
    );
    expect(spread.size).toBeGreaterThan(1);
  });
});

describe('agentRoundness：代理头像圆角', () => {
  it('每个预设使用对应头型，其他代理使用 50', () => {
    expect(agentRoundness('clef')).toBe(100);
    expect(agentRoundness('securityagent')).toBe(15);
    expect(agentRoundness('shippingagent')).toBe(5);
    expect(agentRoundness('billingbot')).toBe(50);
  });
});

describe('agentState：代理状态', () => {
  it('将评审状态转换为团队状态', () => {
    expect(agentState('approved')).toBe('clear');
    expect(agentState('flagged')).toBe('needs');
    expect(agentState('changes_requested')).toBe('asked');
    expect(agentState('reviewing')).toBe('reviewing');
    expect(agentState('not_needed')).toBe('skipped');
    expect(agentState('failed')).toBe('failed');
    expect(agentState('needs')).toBe('needs');
    expect(agentState('running')).toBe('running');
    expect(agentState('learned')).toBe('learned');
    expect(agentState('off')).toBe('off');
    expect(agentState('idle')).toBe('idle');
  });

  it('每个状态都有文字标签，避免仅靠颜色传达', () => {
    expect(STATE_LOOK.clear).toEqual({ label: 'Passed', tone: 'good' });
    expect(STATE_LOOK.needs).toEqual({ label: 'Needs a person', tone: 'warn' });
    expect(STATE_LOOK.asked).toEqual({
      label: 'Changes requested',
      tone: 'serious',
    });
    for (const look of Object.values(STATE_LOOK))
      expect(look.label).toMatch(/^[A-Z][a-z ]+$/);
  });
});

describe('avatarState：规范中的头像状态映射', () => {
  it('将 clear 映射到 success', () => {
    expect(avatarState('approved')).toBe('success');
  });
  it('将 needs 映射到 input 并保持', () => {
    expect(avatarState('flagged')).toBe('input');
    expect(avatarState('needs')).toBe('input');
    expect(avatarScript('input')).toEqual({ hold: 'input' });
  });
  it('将 asked 映射到 send', () => {
    expect(avatarState('changes_requested')).toBe('send');
    expect(avatarScript('send')).toEqual({ play: ['send'] });
  });
  it('将 reviewing 映射到 inspect', () => {
    expect(avatarState('reviewing')).toBe('inspect');
    expect(avatarScript('inspect')).toEqual({ play: ['inspect'] });
  });
  it('将 running 映射到 startWaiting', () => {
    expect(avatarState('running')).toBe('startWaiting');
    expect(avatarScript('startWaiting')).toEqual({ hold: 'waiting' });
  });
  it('将 learned 映射到 surprise，再映射到 send', () => {
    expect(avatarState('learned')).toBe('surprise');
    expect(avatarScript('surprise')).toEqual({ play: ['surprise', 'send'] });
  });
  it('将 off 和 skipped 映射到 sleep', () => {
    expect(avatarState('off')).toBe('sleep');
    expect(avatarState('not_needed')).toBe('sleep');
    expect(avatarScript('sleep')).toEqual({ sleep: true });
  });
  it('将 idle 映射到 idle', () => {
    expect(avatarState('idle')).toBe('idle');
    expect(avatarScript('idle')).toEqual({});
  });
  it('评审失败时显示系统错误表情', () => {
    expect(avatarState('failed')).toBe('error');
    expect(avatarScript('error')).toEqual({ play: ['error'] });
  });
  it('成功动画只播放一次', () => {
    expect(avatarScript('success')).toEqual({ play: ['success'] });
  });
});
