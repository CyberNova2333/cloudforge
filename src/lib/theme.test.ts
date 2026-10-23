// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  MODE_KEY,
  THEME_KEY,
  THEMES,
  parseMode,
  parseThemeId,
  resolveTheme,
  rootAttributes,
} from './theme';

describe('THEMES：主题集合', () => {
  it('按菜单顺序列出七种 HQ 配色和 GitHub', () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      'navy',
      'ink',
      'slate',
      'indigo',
      'forest',
      'claret',
      'paper',
      'github',
    ]);
    expect(THEMES.filter((t) => t.skin === 'dev').map((t) => t.id)).toEqual([
      'github',
    ]);
    for (const t of THEMES) expect(t.swatch).toHaveLength(2);
  });

  it('使用 go- 前缀键保存偏好', () => {
    expect(THEME_KEY).toBe('go-theme-id');
    expect(MODE_KEY).toBe('go-mode');
  });
});

describe('resolveTheme：解析主题', () => {
  it('GitHub 使用 Dev 外观', () => {
    expect(resolveTheme('github', 'light', false).skin).toBe('dev');
    expect(resolveTheme('github', 'dark', false)).toMatchObject({
      skin: 'dev',
      dark: true,
    });
    expect(resolveTheme('navy', 'light', false).skin).toBe('hq');
  });

  it('深色模式下将 Paper 转为 midnight 界面配色', () => {
    expect(resolveTheme('paper', 'dark', false)).toEqual({
      skin: 'hq',
      chrome: 'midnight',
      dark: true,
    });
    expect(resolveTheme('paper', 'light', true).chrome).toBe('paper');
  });

  it('深色模式下保留其他配色', () => {
    expect(resolveTheme('claret', 'dark', false)).toEqual({
      skin: 'hq',
      chrome: 'claret',
      dark: true,
    });
    expect(resolveTheme('forest', 'dark', true).chrome).toBe('forest');
  });

  it('系统模式跟随系统', () => {
    expect(resolveTheme('navy', 'system', true).dark).toBe(true);
    expect(resolveTheme('navy', 'system', false).dark).toBe(false);
    expect(resolveTheme('paper', 'system', true).chrome).toBe('midnight');
    expect(resolveTheme('paper', 'system', false).chrome).toBe('paper');
  });

  it('手动指定模式时忽略系统', () => {
    expect(resolveTheme('navy', 'light', true).dark).toBe(false);
    expect(resolveTheme('navy', 'dark', false).dark).toBe(true);
  });
});

describe('已保存的值', () => {
  it('未知值回退到 Navy 和系统模式', () => {
    expect(parseThemeId('claret')).toBe('claret');
    expect(parseThemeId('neon')).toBe('navy');
    expect(parseThemeId(null)).toBe('navy');
    expect(parseMode('dark')).toBe('dark');
    expect(parseMode('auto')).toBe('system');
    expect(parseMode(undefined)).toBe('system');
  });
});

describe('rootAttributes：根元素属性', () => {
  it('系统模式不设置 data-theme，让 Primer 跟随系统', () => {
    expect(rootAttributes('navy', 'system')).toEqual({
      'data-skin': 'hq',
      'data-theme': null,
      'data-color-mode': 'auto',
      'data-light-theme': 'light',
      'data-dark-theme': 'dark',
    });
  });

  it('将自有样式变量和 Primer 都固定为所选模式', () => {
    expect(rootAttributes('github', 'dark')).toEqual({
      'data-skin': 'dev',
      'data-theme': 'dark',
      'data-color-mode': 'dark',
      'data-light-theme': 'light',
      'data-dark-theme': 'dark',
    });
    expect(rootAttributes('paper', 'light')).toMatchObject({
      'data-skin': 'hq',
      'data-theme': 'light',
      'data-color-mode': 'light',
    });
  });
});
