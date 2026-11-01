// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  filterPulls,
  paginate,
  parsePullsView,
  pullsHref,
  PULLS_PAGE_SIZE,
} from './pullsView';
import type { Pull } from '../api/uiApi';

const params = (s: string) => new URLSearchParams(s);

describe('parsePullsView：解析拉取请求视图', () => {
  it('未选择视图时打开看板', () => {
    expect(parsePullsView(params(''), null)).toEqual({
      view: 'board',
      state: 'open',
      q: '',
      page: 1,
    });
  });

  it('?view= 指定有效视图时使用该值', () => {
    expect(parsePullsView(params('view=list'), null).view).toBe('list');
    expect(parsePullsView(params('view=graph'), null).view).toBe('graph');
    expect(parsePullsView(params('view=board'), 'list').view).toBe('board');
  });

  it('回退到记忆的视图，再回退到看板', () => {
    expect(parsePullsView(params(''), 'graph').view).toBe('graph');
    expect(parsePullsView(params(''), 'list').view).toBe('list');
    expect(parsePullsView(params('view=sideways'), 'list').view).toBe('list');
    expect(parsePullsView(params(''), 'sideways').view).toBe('board');
  });

  it('旧链接携带筛选项时显示列表', () => {
    for (const state of [
      'closed',
      'agent_followup',
      'human_review',
      'waiting',
      'ready',
    ])
      expect(parsePullsView(params(`state=${state}`), 'graph')).toMatchObject({
        view: 'list',
        state,
      });
  });

  it('?view= 优先于旧的状态筛选项', () => {
    expect(
      parsePullsView(params('state=closed&view=board'), null)
    ).toMatchObject({ view: 'board', state: 'closed' });
  });

  it('忽略未知状态', () => {
    expect(parsePullsView(params('state=bogus'), null)).toMatchObject({
      view: 'board',
      state: 'open',
    });
    expect(parsePullsView(params('state=open'), null).state).toBe('open');
  });

  it('读取搜索文本和页码', () => {
    expect(
      parsePullsView(params('q=%20rate%20limit%20&page=3'), null)
    ).toMatchObject({ q: 'rate limit', page: 3 });
    expect(parsePullsView(params('page=0'), null).page).toBe(1);
    expect(parsePullsView(params('page=-2'), null).page).toBe(1);
    expect(parsePullsView(params('page=abc'), null).page).toBe(1);
    expect(parsePullsView(params('page=2.5'), null).page).toBe(1);
  });
});

describe('pullsHref：拉取请求链接', () => {
  const base = '/o/r';

  it('省略所有默认值', () => {
    expect(pullsHref(base, {})).toBe('/o/r/pulls');
    expect(pullsHref(base, { view: 'board', state: 'open', page: 1 })).toBe(
      '/o/r/pulls'
    );
  });

  it('指明视图并保留列表筛选项', () => {
    expect(pullsHref(base, { view: 'list' })).toBe('/o/r/pulls?view=list');
    expect(
      pullsHref(base, { view: 'list', state: 'closed', q: 'a b', page: 2 })
    ).toBe('/o/r/pulls?view=list&state=closed&q=a+b&page=2');
    expect(pullsHref(base, { view: 'graph' })).toBe('/o/r/pulls?view=graph');
  });

  it('仅列表视图携带筛选项', () => {
    expect(pullsHref(base, { view: 'board', state: 'closed', q: 'x' })).toBe(
      '/o/r/pulls'
    );
  });
});

const pull = (n: number, extra: Partial<Pull> = {}): Pull =>
  ({
    id: `p${n}`,
    number: n,
    title: `Pull ${n}`,
    author: { id: 'u', username: 'cho', name: 'Cho Yin', image: null },
    headRef: `branch-${n}`,
    createdVia: null,
    sessionLabel: null,
    ...extra,
  }) as Pull;

describe('filterPulls：筛选拉取请求', () => {
  const all = [
    pull(10, { title: 'Bill in US dollars', headRef: 'billing/s4-usd' }),
    pull(11, {
      title: 'Invoice PDF',
      createdVia: 'Claude Code',
      sessionLabel: 's4',
    }),
    pull(12, {
      title: 'Rate limit',
      author: { id: 'm', username: 'mahmoud', name: 'Mahmoud H.', image: null },
    }),
  ];
  const numbers = (ps: Pull[]) => ps.map((p) => p.number);

  it('搜索为空时返回所有拉取请求', () => {
    expect(filterPulls(all, '')).toHaveLength(3);
    expect(filterPulls(all, '   ')).toHaveLength(3);
  });

  it('匹配标题时忽略大小写', () => {
    expect(numbers(filterPulls(all, 'DOLLARS'))).toEqual([10]);
  });

  it('匹配带或不带井号的编号', () => {
    expect(numbers(filterPulls(all, '#11'))).toEqual([11]);
    expect(numbers(filterPulls(all, '12'))).toEqual([12]);
  });

  it('匹配作者、分支和会话', () => {
    expect(numbers(filterPulls(all, 'mahmoud'))).toEqual([12]);
    expect(numbers(filterPulls(all, 's4-usd'))).toEqual([10]);
    expect(numbers(filterPulls(all, 'claude s4'))).toEqual([11]);
    expect(numbers(filterPulls(all, 'Claude·s4'))).toEqual([11]);
  });

  it('要求每个搜索词都匹配', () => {
    expect(numbers(filterPulls(all, 'invoice pdf'))).toEqual([11]);
    expect(filterPulls(all, 'invoice dollars')).toEqual([]);
  });

  it('手动创建的拉取请求可匹配“by hand”', () => {
    expect(numbers(filterPulls(all, 'by hand'))).toEqual([10, 12]);
  });
});

describe('paginate：分页', () => {
  const items = Array.from({ length: PULLS_PAGE_SIZE * 2 + 3 }, (_, i) => i);

  it('返回第一页', () => {
    const p = paginate(items, 1);
    expect(p.items).toHaveLength(PULLS_PAGE_SIZE);
    expect(p).toMatchObject({ page: 1, pages: 3, total: items.length });
  });

  it('返回不足一页的最后一页', () => {
    const p = paginate(items, 3);
    expect(p.items).toEqual([
      PULLS_PAGE_SIZE * 2,
      PULLS_PAGE_SIZE * 2 + 1,
      PULLS_PAGE_SIZE * 2 + 2,
    ]);
  });

  it('超出范围的页码限制为最后一页', () => {
    expect(paginate(items, 99).page).toBe(3);
  });

  it('无内容时保留一个空页', () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
});
