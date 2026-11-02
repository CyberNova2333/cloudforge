// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  compareVersions,
  formatVersion,
  largestBump,
  parseVersion,
} from '../../releases/version';

const v = (s: string) => parseVersion(s)!;

describe('语义化版本运算', () => {
  it('只解析 vX.Y.Z 格式的标签', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('v0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseVersion('v12345678.0.0')).toEqual({
      major: 12345678,
      minor: 0,
      patch: 0,
    });
    for (const bad of [
      '1.2.3',
      'v1.2',
      'v1.2.3-rc.1',
      'v01.2.3',
      'v1.2.3+b',
      'v-1.0.0',
      'vx.y.z',
      'v123456789.0.0',
      'v0.123456789.0',
      'v0.0.123456789',
    ])
      expect(parseVersion(bad)).toBeNull();
  });

  it('将版本格式化为标签', () => {
    expect(formatVersion({ major: 0, minor: 1, patch: 0 })).toBe('v0.1.0');
  });

  it('提升版本级别并重置较低位', () => {
    expect(bumpVersion(v('v1.4.2'), 'major')).toEqual(v('v2.0.0'));
    expect(bumpVersion(v('v1.4.2'), 'minor')).toEqual(v('v1.5.0'));
    expect(bumpVersion(v('v1.4.2'), 'patch')).toEqual(v('v1.4.3'));
  });

  it('采用最大的升级级别，将 null 和空列表视为 patch', () => {
    expect(largestBump([null, 'patch', 'minor'])).toBe('minor');
    expect(largestBump(['patch', 'major', 'minor'])).toBe('major');
    expect(largestBump([null])).toBe('patch');
    expect(largestBump([])).toBe('patch');
  });

  it('按数值而不是文本比较版本', () => {
    expect(compareVersions(v('v1.10.0'), v('v1.9.9'))).toBeGreaterThan(0);
    expect(compareVersions(v('v2.0.0'), v('v2.0.0'))).toBe(0);
    expect(compareVersions(v('v1.0.0'), v('v1.0.1'))).toBeLessThan(0);
  });
});
