import { describe, expect, it } from 'vitest';
import { cacheObjectKey, findCacheEntry } from '../actions/cache';
import { makeEnv } from './helpers/app';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('Actions 缓存的 restore-keys', () => {
  it('翻完所有分页，取最新上传的条目，而不只看第一页', async () => {
    const t = makeEnv();
    const ref = 'refs/heads/main';
    // Listed by key (a, b, c), uploaded in the same order: the newest is on the last page.
    for (const key of ['deps-a', 'deps-b', 'deps-c']) {
      await t.env.ACTIONS_CACHE.put(cacheObjectKey('repo1', ref, key), key);
      await tick();
    }
    const match = await findCacheEntry(
      t.env,
      'repo1',
      [ref],
      'deps-missing',
      ['deps-'],
      { pageSize: 1 }
    );
    expect(match).toMatchObject({ key: 'deps-c', exact: false });
  });

  it('精确命中主键时直接返回', async () => {
    const t = makeEnv();
    const ref = 'refs/heads/main';
    await t.env.ACTIONS_CACHE.put(cacheObjectKey('repo2', ref, 'k1'), 'x');
    expect(
      await findCacheEntry(t.env, 'repo2', [ref], 'k1', ['k'])
    ).toMatchObject({ key: 'k1', exact: true });
  });
});
