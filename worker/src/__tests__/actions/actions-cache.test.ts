// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { cacheObjectKey, findCacheEntry } from '../../actions/cache';
import { makeEnv } from '../helpers/app';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('Actions 缓存的 restore-keys', () => {
  it.each([
    {
      own: ['deps-own'],
      fallback: ['deps-requested'],
      restore: ['deps-'],
      expected: 'deps-own',
    },
    {
      own: ['second-own'],
      fallback: ['first-default'],
      restore: ['first-', 'second-'],
      expected: 'second-own',
    },
    {
      own: [],
      fallback: ['deps-requested'],
      restore: ['deps-'],
      expected: 'deps-requested',
    },
  ])(
    '先完成当前 ref 的所有匹配，再回退：$expected',
    async ({ own, fallback, restore, expected }) => {
      const t = makeEnv();
      const repositoryId = crypto.randomUUID();
      const refs = ['refs/heads/topic', 'refs/heads/main'];
      for (const [index, keys] of [own, fallback].entries())
        for (const key of keys)
          await t.env.ACTIONS_CACHE.put(
            cacheObjectKey(repositoryId, refs[index], key),
            key
          );
      const match = await findCacheEntry(
        t.env,
        repositoryId,
        refs,
        'deps-requested',
        restore
      );
      expect(match).toMatchObject({
        key: expected,
        objectKey: cacheObjectKey(
          repositoryId,
          refs[own.length ? 0 : 1],
          expected
        ),
        exact: expected === 'deps-requested',
      });
    }
  );

  it('主 key 的前缀匹配优先于 restore key，且不是精确命中', async () => {
    const t = makeEnv();
    const ref = 'refs/heads/topic';
    for (const key of ['deps-primary-new', 'fallback-new'])
      await t.env.ACTIONS_CACHE.put(
        cacheObjectKey('primary-prefix', ref, key),
        key
      );
    expect(
      await findCacheEntry(t.env, 'primary-prefix', [ref], 'deps-primary', [
        'fallback-',
      ])
    ).toMatchObject({ key: 'deps-primary-new', exact: false });
  });

  it('restore key 的精确匹配优先于该 key 的更新前缀匹配', async () => {
    const t = makeEnv();
    const ref = 'refs/heads/topic';
    for (const key of ['deps-', 'deps-newer']) {
      await t.env.ACTIONS_CACHE.put(
        cacheObjectKey('restore-exact', ref, key),
        key
      );
      await tick();
    }
    expect(
      await findCacheEntry(t.env, 'restore-exact', [ref], 'missing', ['deps-'])
    ).toMatchObject({ key: 'deps-', exact: false });
  });

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
