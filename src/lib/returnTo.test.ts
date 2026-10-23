import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

describe('登录后的返回路径', () => {
  it.each([
    null,
    '',
    'https://evil.invalid/',
    '//evil.invalid/',
    '/\\evil.invalid',
    '/\n/evil.invalid',
    '/\t\\evil.invalid',
    '/a/..//evil.invalid',
  ])('拒绝外部或含糊路径：%s', (path) => {
    expect(safeReturnTo(path)).toBe('/');
  });

  it('保留内部查询参数和片段，并规范化点路径段', () => {
    expect(safeReturnTo('/octocat/repo?name=two%20words#L2')).toBe(
      '/octocat/repo?name=two%20words#L2'
    );
    expect(safeReturnTo('/old/../octocat/repo')).toBe('/octocat/repo');
  });
});
