// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { compareRunning, compareSemver, latestOnNpm } from '../versions.ts';

const pkg = { version: '1.2.0', commit: 'abcdef1234567' };

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
const never = (async () => {
  throw new Error('不应发起网络请求');
}) as unknown as typeof fetch;

describe('compareRunning：比较运行版本', () => {
  it('语义版本较旧时判为升级', async () =>
    expect(await compareRunning('1.1.9', pkg, never)).toEqual({
      kind: 'upgrade',
    }));
  it('语义版本相等时判为相同', async () =>
    expect(await compareRunning('v1.2.0', pkg, never)).toEqual({
      kind: 'same',
    }));
  it('语义版本较新时判为降级', async () =>
    expect(await compareRunning('1.10.0', pkg, never)).toEqual({
      kind: 'downgrade',
    }));
  it('预发布版排序：1.2.0-rc.1 < 1.2.0', () => {
    expect(compareSemver('1.2.0-rc.1', '1.2.0')).toBe(-1);
    expect(compareSemver('1.2.0', '1.2.0-rc.1')).toBe(1);
    expect(compareSemver('1.2.0-rc.2', '1.2.0-rc.10')).toBe(-1);
  });
  it('提交落后于发行版本时判为升级', async () => {
    const f = fakeFetch(200, { status: 'ahead' });
    expect(await compareRunning('abc1234', pkg, f.fn)).toEqual({
      kind: 'upgrade',
    });
    expect(f.calls[0]!.url).toBe(
      'https://api.github.com/repos/choyiny/gitorange/compare/abc1234...abcdef1234567'
    );
    const h = f.calls[0]!.init!.headers as Record<string, string>;
    expect(h.Accept).toBe('application/vnd.github+json');
    expect(h['User-Agent']).toBe('cloudforge-cli');
  });
  it('完全相同', async () =>
    expect(
      await compareRunning(
        'abc1234',
        pkg,
        fakeFetch(200, { status: 'identical' }).fn
      )
    ).toEqual({ kind: 'same' }));
  it('提交领先时判为降级', async () =>
    expect(
      await compareRunning(
        'abc1234',
        pkg,
        fakeFetch(200, { status: 'behind' }).fn
      )
    ).toEqual({ kind: 'downgrade' }));
  it('分叉提交判为自定义版本', async () =>
    expect(
      await compareRunning(
        'abc1234',
        pkg,
        fakeFetch(200, { status: 'diverged' }).fn
      )
    ).toEqual({
      kind: 'custom',
      reason: 'commits that are not in the release',
    }));
  it('有未提交改动时判为自定义版本', async () =>
    expect(await compareRunning('abc1234-dirty', pkg, never)).toEqual({
      kind: 'custom',
      reason: 'uncommitted changes',
    }));
  it('未知提交（404）判为自定义版本', async () =>
    expect(await compareRunning('abc1234', pkg, fakeFetch(404, {}).fn)).toEqual(
      {
        kind: 'custom',
        reason: 'could not check commit abc1234 against choyiny/gitorange',
      }
    ));
  it('离线时判为自定义版本', async () =>
    expect(await compareRunning('abc1234', pkg, offline)).toEqual({
      kind: 'custom',
      reason: 'could not check commit abc1234 against choyiny/gitorange',
    }));
  it('空值判为自定义版本', async () =>
    expect(await compareRunning(null, pkg, never)).toEqual({
      kind: 'custom',
      reason: 'the running version is unknown',
    }));
  it('软件包提交为空时直接判为自定义版本且不请求网络', async () =>
    expect(
      await compareRunning('abc1234', { version: '1.2.0', commit: '' }, never)
    ).toEqual({
      kind: 'custom',
      reason: 'could not check commit abc1234 against choyiny/gitorange',
    }));
  it('既不是发行版本也不是提交的值判为自定义版本', async () =>
    expect(await compareRunning('banana', pkg, never)).toEqual({
      kind: 'custom',
      reason: 'the running version "banana" is not a release or a commit',
    }));
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
