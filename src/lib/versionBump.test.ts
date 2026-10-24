// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { bumpLabel, isVersion, parseBump } from './versionBump';

describe('bumpLabel：版本递增标签', () => {
  it('命名递增级别，未指定时按补丁级别显示', () => {
    expect(bumpLabel('major')).toBe('major');
    expect(bumpLabel('minor')).toBe('minor');
    expect(bumpLabel('patch')).toBe('patch');
    expect(bumpLabel(null)).toBe('patch (default)');
  });
});

describe('parseBump：解析版本递增级别', () => {
  it('读取选择框值，其他值视为未设置', () => {
    expect(parseBump('minor')).toBe('minor');
    expect(parseBump('')).toBeNull();
    expect(parseBump('huge')).toBeNull();
  });
});

describe('isVersion：判断版本号', () => {
  it('仅接受纯 vX.Y.Z 格式', () => {
    expect(isVersion('v0.1.0')).toBe(true);
    expect(isVersion(' v12.0.3 ')).toBe(true);
    expect(isVersion('0.1.0')).toBe(false);
    expect(isVersion('v1.0.0-rc.1')).toBe(false);
    expect(isVersion('v1.0')).toBe(false);
    // As the server takes them: no leading zeros, at most 8 digits a part.
    expect(isVersion('v01.0.0')).toBe(false);
    expect(isVersion('v1.00.0')).toBe(false);
    expect(isVersion('v12345678.0.0')).toBe(true);
    expect(isVersion('v123456789.0.0')).toBe(false);
  });
});
