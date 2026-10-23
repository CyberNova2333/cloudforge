// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  CLEARED,
  EMPTY_RESULTS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_GROUPS,
  SEARCH_MAX_CHARS,
  blurCloses,
  flattenSections,
  hitsFromResults,
  jumpHits,
  pageHits,
  searchKey,
  searchSections,
  searchTerm,
  type SearchHit,
} from './searchKeys';

const hit = (kind: SearchHit['kind'], label: string): SearchHit => ({
  kind,
  label,
  sub: null,
  to: `/${kind}/${label}`,
});

describe('searchSections：搜索结果分组', () => {
  it('无论返回顺序如何，都按规范顺序分组', () => {
    const sections = searchSections('a', [
      hit('page', 'Approvals'),
      hit('file', 'src/a.ts'),
      hit('person', 'amira'),
      hit('repo', 'a/app'),
      hit('branch', 'add-x'),
      hit('agent', 'dataagent'),
      hit('pull', '#3 Add'),
    ]);
    expect(sections.map((s) => s.title)).toEqual([
      'Repositories',
      'Pull requests',
      'Agents',
      'People',
      'Branches',
      'Files',
      'Pages',
    ]);
    expect(SEARCH_GROUPS.map((g) => g.title)).toEqual(
      sections.map((s) => s.title)
    );
  });

  it('移除空组并限制每组数量', () => {
    const repos = Array.from({ length: 9 }, (_, i) => hit('repo', `o/r${i}`));
    const sections = searchSections('r', [...repos, hit('person', 'rae')], {
      perGroup: 4,
    });
    expect(sections.map((s) => [s.title, s.hits.length])).toEqual([
      ['Repositories', 4],
      ['People', 1],
    ]);
  });

  it('没有查询时提供一个跳转列表', () => {
    const sections = searchSections('  ', [hit('repo', 'a/one')]);
    expect(sections).toEqual([
      { title: 'Jump to', hits: [hit('repo', 'a/one')] },
    ]);
  });

  it('展平后保持键盘导航顺序', () => {
    const sections = searchSections('a', [
      hit('person', 'amira'),
      hit('repo', 'a/app'),
    ]);
    expect(flattenSections(sections).map((h) => h.label)).toEqual([
      'a/app',
      'amira',
    ]);
  });
});

describe('searchKey：搜索键盘操作', () => {
  const hits = [hit('repo', 'a'), hit('repo', 'b'), hit('repo', 'c')];

  it('ArrowDown 向下移动，并从末项循环到首项', () => {
    let state = { q: 'x', sel: 0 };
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = searchKey(state, 'ArrowDown', hits);
      expect(r.handled).toBe(true);
      state = r.state;
      seen.push(state.sel);
    }
    expect(seen).toEqual([1, 2, 0, 1]);
  });

  it('ArrowUp 向上移动，并从首项循环到末项', () => {
    const r = searchKey({ q: 'x', sel: 0 }, 'ArrowUp', hits);
    expect(r.state.sel).toBe(2);
    expect(searchKey(r.state, 'ArrowUp', hits).state.sel).toBe(1);
  });

  it('没有结果时方向键不移动选择，也不移动光标', () => {
    const r = searchKey({ q: 'zz', sel: 0 }, 'ArrowDown', []);
    expect(r).toMatchObject({ handled: true, state: { q: 'zz', sel: 0 } });
  });

  it('Enter 打开选中结果并清空搜索', () => {
    const r = searchKey({ q: 'x', sel: 1 }, 'Enter', hits);
    expect(r).toEqual({
      handled: true,
      close: true,
      go: '/repo/b',
      state: CLEARED,
    });
  });

  it('没有可打开项时 Enter 不执行操作', () => {
    expect(searchKey({ q: 'zz', sel: 0 }, 'Enter', [])).toMatchObject({
      handled: false,
      go: null,
      close: false,
    });
  });

  it('Escape 清空查询并关闭', () => {
    expect(searchKey({ q: 'abc', sel: 2 }, 'Escape', hits)).toEqual({
      handled: true,
      close: true,
      go: null,
      state: CLEARED,
    });
    expect(CLEARED).toEqual({ q: '', sel: 0 });
  });

  it('其他按键交由输入框处理', () => {
    const r = searchKey({ q: 'ab', sel: 1 }, 'a', hits);
    expect(r).toEqual({
      handled: false,
      close: false,
      go: null,
      state: { q: 'ab', sel: 1 },
    });
  });

  it('结果减少后修正过期的选中位置', () => {
    expect(searchKey({ q: 'x', sel: 7 }, 'Enter', hits).go).toBe('/repo/c');
  });
});

describe('blurCloses：离开搜索框', () => {
  const tabbedOut = {
    windowFocused: true,
    pressedInside: false,
    focusInside: false,
  };

  it('焦点移至页面其他位置时关闭，例如按 Tab 离开', () => {
    expect(blurCloses(tabbedOut)).toBe(true);
  });

  it('整个窗口失去焦点时保持打开，例如切换应用', () => {
    expect(blurCloses({ ...tabbedOut, windowFocused: false })).toBe(false);
  });

  it('在搜索框内部按下鼠标后保持打开，例如结果滚动条', () => {
    expect(blurCloses({ ...tabbedOut, pressedInside: true })).toBe(false);
  });

  it('焦点移至框内其他元素时保持打开', () => {
    expect(blurCloses({ ...tabbedOut, focusInside: true })).toBe(false);
  });
});

describe('searchTerm：发送到 /api/search 的查询', () => {
  it('去除输入首尾空白，空框不发送查询', () => {
    expect(searchTerm('  auth  ')).toBe('auth');
    expect(searchTerm('   ')).toBe('');
    expect(searchTerm('')).toBe('');
  });

  it('保留内部空格和 #12 形式的拉取请求编号', () => {
    expect(searchTerm(' fix login ')).toBe('fix login');
    expect(searchTerm('#12')).toBe('#12');
  });

  it('按 API 读取上限截断查询，远低于拒绝请求的长度', () => {
    const long = 'a'.repeat(300);
    expect(searchTerm(long)).toHaveLength(SEARCH_MAX_CHARS);
    expect(SEARCH_MAX_CHARS).toBeLessThanOrEqual(200);
    // A cut that lands after a space doesn't leave the space on the end.
    expect(searchTerm('a'.repeat(SEARCH_MAX_CHARS - 1) + ' b')).toBe(
      'a'.repeat(SEARCH_MAX_CHARS - 1)
    );
  });

  it('短暂等待用户停止输入', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
  });
});

describe('EMPTY_RESULTS：空结果', () => {
  it('包含符合 API 结构的六个空列表', () => {
    expect(EMPTY_RESULTS).toEqual({
      repos: [],
      pulls: [],
      agents: [],
      people: [],
      branches: [],
      files: [],
    });
    expect(hitsFromResults(EMPTY_RESULTS)).toEqual([]);
  });
});

describe('hitsFromResults：从结果生成匹配项', () => {
  it('将每类结果链接到对应页面', () => {
    const hits = hitsFromResults(
      {
        repos: [{ name: 'o/r', description: 'd' }],
        pulls: [{ repo: 'o/r', number: 4, title: 'Fix', state: 'open' }],
        agents: [{ handle: 'dataagent', name: 'Data', color: '#199e70' }],
        people: [{ login: 'cho', name: null }],
        branches: [{ repo: 'o/r', name: 'feat/a b' }],
        files: [{ repo: 'o/r', path: 'src/a b.ts' }],
      },
      { defaultBranch: 'main' }
    );
    expect(hits.find((h) => h.kind === 'pull')?.sub).toBe('o/r · open');
    expect(hits.map((h) => [h.kind, h.label, h.to])).toEqual([
      ['repo', 'o/r', '/o/r'],
      ['pull', '#4 Fix', '/o/r/pull/4'],
      ['agent', 'Data', '/dataagent'],
      ['person', 'cho', '/cho'],
      ['branch', 'feat/a b', '/o/r/tree/feat/a%20b'],
      ['file', 'src/a b.ts', '/o/r/blob/main/src/a%20b.ts'],
    ]);
    expect(hits[2].color).toBe('#199e70');
  });
});

describe('jumpHits：跳转结果', () => {
  it('最近访问的仓库优先，其余在后', () => {
    const hits = jumpHits(
      [
        { fullName: 'a/one', description: null },
        { fullName: 'a/two', description: 'Two' },
        { fullName: 'a/three', description: null },
      ],
      ['a/three', 'gone/repo']
    );
    expect(hits.map((h) => h.label)).toEqual(['a/three', 'a/one', 'a/two']);
  });
});

describe('pageHits：页面结果', () => {
  it('按名称查找页面，仅管理员可见站点管理页面', () => {
    expect(pageHits('usage', { admin: false, repo: null })).toEqual([]);
    expect(
      pageHits('usage', { admin: true, repo: null }).map((h) => h.to)
    ).toEqual(['/admin/usage']);
    expect(
      pageHits('email', { admin: false, repo: null }).map((h) => h.to)
    ).toEqual(['/settings/emails']);
  });

  it('所有人可见代理目录，管理员可见新建评审者', () => {
    expect(
      pageHits('agents', { admin: false, repo: null }).map((h) => h.to)
    ).toEqual(['/agents']);
    expect(
      pageHits('reviewer', { admin: false, repo: null }).map((h) => h.to)
    ).toEqual(['/agents']);
    expect(
      pageHits('reviewer', { admin: true, repo: null }).map((h) => h.to)
    ).toEqual(['/agents/new', '/agents']);
  });

  it('关键字只匹配词首而非词内', () => {
    // "password" and "cursor" are keywords of the token and MCP pages; "or" is inside them, not a word start.
    expect(
      pageHits('or', { admin: false, repo: null }).map((h) => h.label)
    ).toEqual(['Repositories', 'New repository']);
    expect(
      pageHits('curs', { admin: false, repo: null }).map((h) => h.label)
    ).toEqual(['MCP server']);
  });

  it('位于仓库中时加入当前仓库的标签页', () => {
    expect(pageHits('actions', { admin: false, repo: null })).toEqual([]);
    expect(
      pageHits('actions', { admin: false, repo: 'o/r' }).map((h) => [
        h.label,
        h.to,
      ])
    ).toEqual([['Actions', '/o/r/actions']]);
  });
});
