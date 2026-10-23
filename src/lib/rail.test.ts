// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { railClasses } from './rail';

describe('railClasses：侧栏样式类', () => {
  it('默认折叠，在布局中宽 64px', () => {
    expect(railClasses({ pinned: false, peek: false, narrow: false })).toBe(
      'snav shut'
    );
  });

  it('预览以覆盖层展开，布局仍折叠，页面不移动', () => {
    expect(railClasses({ pinned: false, peek: true, narrow: false })).toBe(
      'snav shut peeking'
    );
  });

  it('固定侧栏占完整宽度，预览状态不影响布局', () => {
    expect(railClasses({ pinned: true, peek: false, narrow: false })).toBe(
      'snav pinned'
    );
    expect(railClasses({ pinned: true, peek: true, narrow: false })).toBe(
      'snav pinned'
    );
  });

  it('窄屏始终显示带标签的完整抽屉，不受其他设置影响', () => {
    for (const pinned of [false, true])
      for (const peek of [false, true])
        expect(railClasses({ pinned, peek, narrow: true })).toBe('snav');
  });
});
