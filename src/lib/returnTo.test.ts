import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

describe('post-sign-in return path', () => {
  it.each([
    null,
    '',
    'https://evil.invalid/',
    '//evil.invalid/',
    '/\\evil.invalid',
    '/\n/evil.invalid',
    '/\t\\evil.invalid',
    '/a/..//evil.invalid',
  ])('rejects an external or ambiguous path: %s', (path) => {
    expect(safeReturnTo(path)).toBe('/');
  });

  it('keeps internal query strings and fragments, and normalizes dot segments', () => {
    expect(safeReturnTo('/octocat/repo?name=two%20words#L2')).toBe(
      '/octocat/repo?name=two%20words#L2'
    );
    expect(safeReturnTo('/old/../octocat/repo')).toBe('/octocat/repo');
  });
});
