// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it, vi } from 'vitest';
import {
  compareRunning,
  compareSemver,
  latestOnNpm,
} from '../../distribution/versions.ts';

// What pack.mjs writes into history.txt: the release's own commit first, then everything it contains.
const RELEASE = 'abcdef1234567890abcdef1234567890abcdef12';
const OLDER = '1234567890abcdef1234567890abcdef12345678';
const OLDEST = 'fedcba0987654321fedcba0987654321fedcba09';
const pkg = {
  version: '1.2.0',
  commit: RELEASE,
  history: [RELEASE, OLDER, OLDEST],
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const offline = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

describe('compareRunning：比较运行版本', () => {
  it('语义版本较旧时判为升级', () =>
    expect(compareRunning('1.1.9', pkg)).toEqual({ kind: 'upgrade' }));
  it('语义版本相等时判为相同', () =>
    expect(compareRunning('v1.2.0', pkg)).toEqual({ kind: 'same' }));
  it('语义版本较新时判为降级', () =>
    expect(compareRunning('1.10.0', pkg)).toEqual({ kind: 'downgrade' }));
  it('预发布版排序：1.2.0-rc.1 < 1.2.0', () => {
    expect(compareSemver('1.2.0-rc.1', '1.2.0')).toBe(-1);
    expect(compareSemver('1.2.0', '1.2.0-rc.1')).toBe(1);
    expect(compareSemver('1.2.0-rc.2', '1.2.0-rc.10')).toBe(-1);
  });
  it('提交就是该版本自己的提交时判为相同（长短前缀都认）', () => {
    expect(compareRunning(RELEASE, pkg)).toEqual({ kind: 'same' });
    expect(compareRunning(RELEASE.slice(0, 12), pkg)).toEqual({ kind: 'same' });
  });
  it('提交在该版本的历史中时判为升级（检出目录部署的 12 位与完整提交号）', () => {
    expect(compareRunning(OLDER.slice(0, 12), pkg)).toEqual({
      kind: 'upgrade',
    });
    expect(compareRunning(OLDEST, pkg)).toEqual({ kind: 'upgrade' });
  });
  it('提交不在该版本的历史中时判为自定义版本，并说明可能是更新的构建', () =>
    expect(compareRunning('0123456789ab', pkg)).toEqual({
      kind: 'custom',
      reason:
        'commit 0123456789ab is not in 1.2.0 (a newer build, or commits that are not in a release)',
    }));
  it('旧版软件包没有提交历史时判为自定义版本', () => {
    const reason =
      'this package does not list the commits of 1.2.0, so commit 123456789012 cannot be checked';
    expect(
      compareRunning('123456789012', { version: '1.2.0', commit: RELEASE })
    ).toEqual({ kind: 'custom', reason });
    expect(
      compareRunning('123456789012', {
        version: '1.2.0',
        commit: RELEASE,
        history: null,
      })
    ).toEqual({ kind: 'custom', reason });
    expect(
      compareRunning('123456789012', {
        version: '1.2.0',
        commit: '',
        history: [OLDER],
      })
    ).toEqual({ kind: 'custom', reason });
  });
  it('有未提交改动时判为自定义版本，即使提交在历史中', () =>
    expect(compareRunning(`${OLDER.slice(0, 12)}-dirty`, pkg)).toEqual({
      kind: 'custom',
      reason: 'uncommitted changes',
    }));
  it('空值判为自定义版本', () =>
    expect(compareRunning(null, pkg)).toEqual({
      kind: 'custom',
      reason: 'the running version is unknown',
    }));
  it('既不是发行版本也不是提交的值判为自定义版本', () =>
    expect(compareRunning('banana', pkg)).toEqual({
      kind: 'custom',
      reason: 'the running version "banana" is not a release or a commit',
    }));
  it('比较时不发起任何网络请求', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    compareRunning(OLDER, pkg);
    compareRunning('0123456789ab', pkg);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('latestOnNpm：npm 最新版本', () => {
  it('读取 dist-tags.latest', async () => {
    const f = fakeFetch(200, { 'dist-tags': { latest: '1.4.0' } });
    expect(await latestOnNpm(f.fn)).toBe('1.4.0');
    expect(f.calls[0]!.url).toBe(
      'https://registry.npmjs.org/@cybernova2333%2fcloudforge'
    );
  });
  it('离线时返回 null', async () =>
    expect(await latestOnNpm(offline)).toBeNull());
});
