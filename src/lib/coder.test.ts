// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { coderOf } from './coder';

describe('coderOf：编码助手信息', () => {
  it('使用简称和标签命名 Claude Code 会话', () => {
    expect(coderOf('Claude Code', 's4')).toEqual({
      kind: 'claude',
      mono: 'C',
      name: 'Claude',
      label: 'Claude·s4',
      title: 'Claude Code session s4',
    });
  });

  it('为 Codex 使用独有的字母标识', () => {
    expect(coderOf('Codex', 's5')).toMatchObject({
      kind: 'codex',
      mono: 'X',
      name: 'Codex',
      label: 'Codex·s5',
    });
  });

  it('匹配应用名时忽略大小写和后缀', () => {
    expect(coderOf('claude desktop', 's1').kind).toBe('claude');
    expect(coderOf('CODEX CLI', null).kind).toBe('codex');
  });

  it('其他应用取首个单词及首字母', () => {
    expect(coderOf('Cursor Agent', 's9')).toMatchObject({
      kind: 'other',
      mono: 'C',
      name: 'Cursor',
      label: 'Cursor·s9',
      title: 'Cursor Agent session s9',
    });
  });

  it('未报告会话标签时只显示应用名', () => {
    expect(coderOf('Claude Code', null)).toMatchObject({
      label: 'Claude',
      title: 'Claude Code',
    });
    expect(coderOf('Claude Code', '   ').label).toBe('Claude');
  });

  it('没有应用信息时视为手动创建的拉取请求', () => {
    expect(coderOf(null, null)).toEqual({
      kind: 'person',
      mono: '',
      name: 'By hand',
      label: 'by hand',
      title: 'Opened by hand',
    });
    expect(coderOf('', 's4').kind).toBe('person');
    expect(coderOf(undefined, undefined).kind).toBe('person');
  });

  it('缩短过长的应用名', () => {
    const c = coderOf('A'.repeat(40) + ' Agent', 's1');
    expect(c.name.length).toBeLessThanOrEqual(14);
    expect(c.name.endsWith('…')).toBe(true);
  });
});
