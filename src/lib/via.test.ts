// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { withVia } from './via';

describe('withVia：附加来源', () => {
  it('显示决定所经由的应用名称', () => {
    expect(withVia('octocat', 'Claude Mod')).toBe('octocat via Claude Mod');
  });
  it('网页中的决定仅显示用户', () => {
    expect(withVia('octocat', null)).toBe('octocat');
    expect(withVia('octocat', undefined)).toBe('octocat');
    expect(withVia('octocat', '')).toBe('octocat');
  });
});
