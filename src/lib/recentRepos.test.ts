// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  RECENT_MAX,
  addRecent,
  parseRecent,
  readRecent,
  recentKey,
  removeRecent,
  writeRecent,
  type RecentRepo,
} from './recentRepos';

const repo = (fullName: string, agent?: RecentRepo['agent']): RecentRepo =>
  agent ? { fullName, agent } : { fullName };

/** A Storage stand-in: the tests run in workerd, which has no localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError: storage is blocked');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('addRecent：添加最近访问', () => {
  it('将最近访问放在最前', () => {
    const list = addRecent(addRecent([], repo('a/one')), repo('a/two'));
    expect(list.map((r) => r.fullName)).toEqual(['a/two', 'a/one']);
  });

  it('再次访问时移到最前并去重', () => {
    let list: RecentRepo[] = [];
    for (const name of ['a/one', 'a/two', 'a/three', 'A/One'])
      list = addRecent(list, repo(name));
    expect(list.map((r) => r.fullName)).toEqual(['A/One', 'a/three', 'a/two']);
  });

  it('再次访问时使用较新的详情，包括后来识别出的代理仓库', () => {
    const list = addRecent(
      [repo('dataagent/dataagent')],
      repo('dataagent/dataagent', { handle: 'dataagent', color: '#199e70' })
    );
    expect(list).toEqual([
      {
        fullName: 'dataagent/dataagent',
        agent: { handle: 'dataagent', color: '#199e70' },
      },
    ]);
  });

  it(`最多保留 ${RECENT_MAX} 项，并移除最早的记录`, () => {
    let list: RecentRepo[] = [];
    for (let i = 1; i <= 7; i++) list = addRecent(list, repo(`o/r${i}`));
    expect(RECENT_MAX).toBe(5);
    expect(list.map((r) => r.fullName)).toEqual([
      'o/r7',
      'o/r6',
      'o/r5',
      'o/r4',
      'o/r3',
    ]);
  });

  it('不修改传入的列表', () => {
    const before = [repo('a/one')];
    addRecent(before, repo('a/two'));
    expect(before).toEqual([repo('a/one')]);
  });
});

describe('removeRecent：移除最近访问', () => {
  it('忽略大小写移除已删除或重命名的仓库', () => {
    expect(
      removeRecent([repo('a/one'), repo('a/two')], 'A/ONE').map(
        (r) => r.fullName
      )
    ).toEqual(['a/two']);
  });
});

describe('parseRecent：解析最近访问', () => {
  it('读回写入的内容', () => {
    const list = [
      repo('choyiny/gitorange'),
      repo('dataagent/dataagent', { handle: 'dataagent', color: null }),
    ];
    expect(parseRecent(JSON.stringify(list))).toEqual(list);
  });

  it('容忍无效 JSON 和非列表值', () => {
    for (const raw of [null, '', '{', 'null', '42', '"a/b"', '{"a":1}'])
      expect(parseRecent(raw)).toEqual([]);
  });

  it('跳过格式错误的条目，保留有效条目', () => {
    const raw = JSON.stringify([
      1,
      null,
      { fullName: 3 },
      { fullName: 'no-slash' },
      { fullName: 'too/many/parts' },
      { fullName: 'a/ok', agent: 'nope' },
      { fullName: 'b/ok', agent: { handle: 'b', color: 7 } },
    ]);
    expect(parseRecent(raw)).toEqual([
      { fullName: 'a/ok' },
      { fullName: 'b/ok', agent: { handle: 'b', color: null } },
    ]);
  });

  it(`即使存储中有更多记录，也会去重并限制为 ${RECENT_MAX} 项`, () => {
    const names = ['a/1', 'a/2', 'A/1', 'a/3', 'a/4', 'a/5', 'a/6', 'a/7'];
    expect(
      parseRecent(JSON.stringify(names.map((n) => repo(n)))).map(
        (r) => r.fullName
      )
    ).toEqual(['a/1', 'a/2', 'a/3', 'a/4', 'a/5']);
  });
});

describe('存储', () => {
  it('每个用户保留独立列表', () => {
    expect(recentKey('u1')).not.toBe(recentKey('u2'));
    expect(recentKey('u1').startsWith('go-')).toBe(true);
  });

  it('通过存储完整写入和读回', () => {
    const storage = memoryStorage();
    writeRecent(storage, 'k', [repo('a/one')]);
    expect(readRecent(storage, 'k')).toEqual([repo('a/one')]);
  });

  it('存储缺失、被阻止或包含无效内容时读取为空列表', () => {
    expect(readRecent(null, 'k')).toEqual([]);
    expect(readRecent(throwing, 'k')).toEqual([]);
    expect(readRecent(memoryStorage({ k: '[{' }), 'k')).toEqual([]);
  });

  it('写入失败时不抛出错误', () => {
    expect(() => writeRecent(throwing, 'k', [repo('a/one')])).not.toThrow();
    expect(() => writeRecent(null, 'k', [repo('a/one')])).not.toThrow();
  });
});
