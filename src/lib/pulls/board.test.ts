// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  boardRows,
  boardTotals,
  crewActivity,
  dayLabels,
  filterBoard,
  filterCounts,
  flightSegments,
  languageColor,
  mostPressing,
  needsAttention,
  parseBoardParams,
  pullChip,
  type BoardRow,
} from './board';
import type { Agent, RepoStats, RepoWithStats } from '../api/uiApi';

type StatsOver = Omit<Partial<RepoStats>, 'pulls'> & {
  pulls?: Partial<RepoStats['pulls']>;
};

const stats = ({ pulls, ...over }: StatsOver = {}): RepoStats => ({
  pulls: {
    open: 0,
    needsPerson: 0,
    changesRequested: 0,
    checking: 0,
    queued: 0,
    ...pulls,
  },
  merged7d: 0,
  mergedByDay: [0, 0, 0, 0, 0, 0, 0],
  mergedAutomaticallyPct: null,
  agents: [],
  branchCount: 1,
  language: null,
  updatedAt: 1000,
  ...over,
});

const repo = (
  owner: string,
  name: string,
  over: StatsOver = {},
  description: string | null = null
): RepoWithStats => ({
  id: `${owner}-${name}`,
  owner: { id: owner, username: owner, name: owner, image: null },
  ownerType: 'user',
  visibility: 'internal',
  name,
  fullName: `${owner}/${name}`,
  description,
  defaultBranch: 'main',
  protectedBranches: [],
  deleteMergedBranches: true,
  hasIssues: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  stats: stats(over),
});

const agent = (handle: string, over: Partial<Agent> = {}): Agent => ({
  id: handle,
  username: handle,
  reviewLanguage: 'en',
  name: handle,
  image: null,
  bio: 'Checks things.',
  trigger: { ask: 'Does it?', above: 0.5 },
  engine: 'pass',
  color: '#2a78d6',
  facet: null,
  guarded: false,
  repository: `${handle}/${handle}`,
  configSha: null,
  configError: null,
  createdAt: '2026-10-01T00:00:00Z',
  deletedAt: null,
  ...over,
});

describe('boardRows：看板行', () => {
  it('将仓库与保存其指令的代理配对', () => {
    const rows = boardRows(
      [repo('mahmoud', 'invoices'), repo('dataagent', 'dataagent')],
      [agent('dataagent')]
    );
    expect(rows.map((r) => r.agent?.username ?? null)).toEqual([
      null,
      'dataagent',
    ]);
  });

  it('仓库所有者和名称都必须与代理账号名一致', () => {
    const rows = boardRows(
      [repo('mahmoud', 'dataagent'), repo('dataagent', 'notes')],
      [agent('dataagent')]
    );
    expect(rows.every((r) => r.agent === null)).toBe(true);
  });

  it('忽略已删除的代理', () => {
    const rows = boardRows(
      [repo('dataagent', 'dataagent')],
      [agent('dataagent', { deletedAt: '2026-10-02T00:00:00Z' })]
    );
    expect(rows[0].agent).toBeNull();
  });
});

describe('needsAttention：需要关注', () => {
  it('仅人在待行动时需要关注，代理待行动不算', () => {
    expect(
      needsAttention(
        boardRows([repo('a', 'b', { pulls: { needsPerson: 1 } })], [])[0]
      )
    ).toBe(true);
    expect(
      needsAttention(
        boardRows([repo('a', 'b', { pulls: { changesRequested: 3 } })], [])[0]
      )
    ).toBe(false);
  });
});

describe('filterBoard：筛选看板', () => {
  const rows: BoardRow[] = boardRows(
    [
      repo('mahmoud', 'website', { updatedAt: 10 }, 'Marketing site'),
      repo(
        'mahmoud',
        'invoices',
        { updatedAt: 30, pulls: { needsPerson: 2 } },
        'Invoices and PDFs'
      ),
      repo('dataagent', 'dataagent', { updatedAt: 20 }, 'Keeps data safe'),
    ],
    [agent('dataagent')]
  );
  const names = (r: BoardRow[]) => r.map((x) => x.repo.fullName);

  it('按最近更新时间或名称排序', () => {
    expect(
      names(filterBoard(rows, { query: '', filter: 'all', sort: 'updated' }))
    ).toEqual(['mahmoud/invoices', 'dataagent/dataagent', 'mahmoud/website']);
    expect(
      names(filterBoard(rows, { query: '', filter: 'all', sort: 'name' }))
    ).toEqual(['dataagent/dataagent', 'mahmoud/invoices', 'mahmoud/website']);
  });

  it('筛选代码、代理指令和需要关注的条目', () => {
    expect(
      names(filterBoard(rows, { query: '', filter: 'code', sort: 'name' }))
    ).toEqual(['mahmoud/invoices', 'mahmoud/website']);
    expect(
      names(filterBoard(rows, { query: '', filter: 'agent', sort: 'name' }))
    ).toEqual(['dataagent/dataagent']);
    expect(
      names(filterBoard(rows, { query: '', filter: 'attention', sort: 'name' }))
    ).toEqual(['mahmoud/invoices']);
  });

  it('忽略大小写搜索名称和描述', () => {
    expect(
      names(filterBoard(rows, { query: 'PDF', filter: 'all', sort: 'name' }))
    ).toEqual(['mahmoud/invoices']);
    expect(
      names(
        filterBoard(rows, {
          query: ' MAHMOUD/web ',
          filter: 'all',
          sort: 'name',
        })
      )
    ).toEqual(['mahmoud/website']);
    expect(
      names(filterBoard(rows, { query: 'zzz', filter: 'all', sort: 'name' }))
    ).toEqual([]);
  });

  it('在搜索结果范围内统计各筛选项', () => {
    expect(filterCounts(rows, '')).toEqual({
      all: 3,
      attention: 1,
      code: 2,
      agent: 1,
    });
    expect(filterCounts(rows, 'data')).toEqual({
      all: 1,
      attention: 0,
      code: 0,
      agent: 1,
    });
  });
});

describe('boardTotals：看板总计', () => {
  it('累加开放和已合并数量，并加权计算自动合并比例', () => {
    const rows = boardRows(
      [
        repo('a', 'one', {
          pulls: { open: 4 },
          merged7d: 10,
          mergedAutomaticallyPct: 80,
        }),
        repo('a', 'two', {
          pulls: { open: 1 },
          merged7d: 10,
          mergedAutomaticallyPct: 40,
        }),
        repo('a', 'three', {}),
      ],
      []
    );
    expect(boardTotals(rows)).toEqual({
      repositories: 3,
      open: 5,
      merged7d: 20,
      automatic: 12,
      automaticPct: 60,
    });
  });

  it('没有合并记录时无比例', () => {
    expect(boardTotals(boardRows([repo('a', 'one')], [])).automaticPct).toBe(
      null
    );
    expect(boardTotals([])).toEqual({
      repositories: 0,
      open: 0,
      merged7d: 0,
      automatic: 0,
      automaticPct: null,
    });
  });
});

describe('flightSegments：进行中分组', () => {
  it('按当前应行动角色的顺序列出有拉取请求的分组', () => {
    expect(
      flightSegments({
        open: 6,
        needsPerson: 1,
        changesRequested: 2,
        checking: 2,
        queued: 1,
      })
    ).toEqual([
      { key: 'needs', label: 'needs a person', count: 1 },
      { key: 'asked', label: 'changes requested', count: 2 },
      { key: 'reviewing', label: 'checking', count: 2 },
      { key: 'clear', label: 'queued', count: 1 },
    ]);
  });

  it('省略空分组，合计可少于开放数量', () => {
    expect(
      flightSegments({
        open: 5,
        needsPerson: 0,
        changesRequested: 0,
        checking: 2,
        queued: 0,
      })
    ).toEqual([{ key: 'reviewing', label: 'checking', count: 2 }]);
    expect(
      flightSegments({
        open: 0,
        needsPerson: 0,
        changesRequested: 0,
        checking: 0,
        queued: 0,
      })
    ).toEqual([]);
  });
});

describe('pullChip：拉取请求标签', () => {
  const p = (o: Partial<RepoStats['pulls']>) => ({
    open: 0,
    needsPerson: 0,
    changesRequested: 0,
    checking: 0,
    queued: 0,
    ...o,
  });
  it('优先显示人工待行动', () => {
    expect(pullChip(p({ open: 3, needsPerson: 1, checking: 2 }))).toEqual({
      tone: 'warn',
      label: '1 needs a person',
    });
    expect(pullChip(p({ open: 3, needsPerson: 2 }))).toEqual({
      tone: 'warn',
      label: '2 need a person',
    });
  });
  it('其次显示代理待修改、检查运行中和合并队列', () => {
    expect(pullChip(p({ open: 2, changesRequested: 2 }))).toEqual({
      tone: 'serious',
      label: '2 with changes requested',
    });
    expect(pullChip(p({ open: 1, checking: 1 }))).toEqual({
      tone: 'info',
      label: '1 being checked',
    });
    expect(pullChip(p({ open: 2, queued: 2 }))).toEqual({
      tone: 'good',
      label: '2 queued to merge',
    });
  });
  it('无开放请求时使用中性色，分组遗漏请求时显示普通标签', () => {
    expect(pullChip(p({}))).toEqual({
      tone: 'off',
      label: 'No open pull requests',
    });
    expect(pullChip(p({ open: 2 }))).toEqual({ tone: 'off', label: '2 open' });
  });
});

describe('mostPressing 和 crewActivity：紧迫程度与团队活动', () => {
  it('优先级依次为阻塞合并、进行中、已完成', () => {
    expect(mostPressing(['idle', 'approved', 'reviewing'])).toBe('reviewing');
    expect(mostPressing(['approved', 'flagged', 'changes_requested'])).toBe(
      'changes_requested'
    );
    expect(mostPressing(['failed', 'flagged'])).toBe('failed');
    expect(mostPressing(['idle', 'not_needed'])).toBe('idle');
    expect(mostPressing([])).toBe('idle');
  });

  it('汇总代理在多个仓库中的状态', () => {
    const a = { handle: 'dataagent', name: 'Data', color: '#199e70' };
    const rows = boardRows(
      [
        repo('a', 'one', { agents: [{ ...a, status: 'approved' }] }),
        repo('a', 'two', { agents: [{ ...a, status: 'flagged' }] }),
        repo('a', 'three', {
          agents: [
            {
              handle: 'speedagent',
              name: 'Speed',
              color: '#c98500',
              status: 'idle',
            },
          ],
        }),
      ],
      []
    );
    const crew = crewActivity(rows);
    expect(crew.map((c) => [c.handle, c.status])).toEqual([
      ['dataagent', 'flagged'],
      ['speedagent', 'idle'],
    ]);
    expect(crew[0]).toMatchObject({ name: 'Data', color: '#199e70' });
  });
});

describe('dayLabels：日期标签', () => {
  it('以 UTC 命名最近日期，从最早到今天排列', () => {
    const labels = dayLabels(7, Date.UTC(2026, 9, 9, 23, 30));
    expect(labels).toHaveLength(7);
    expect(labels[6]).toBe('Fri, Oct 9');
    expect(labels[0]).toBe('Sat, Oct 3');
  });
});

describe('languageColor：语言颜色', () => {
  it('识别看板中的语言，未知时回退为灰色', () => {
    expect(languageColor('TypeScript')).toBe('#0C5CAB');
    expect(languageColor('Python')).toBe('#397db9');
    expect(languageColor('Brainfuck')).toBe('#626263');
    expect(languageColor(null)).toBe('#626263');
  });
});

describe('parseBoardParams：解析看板参数', () => {
  it('从地址读取搜索、筛选和排序，忽略无效内容', () => {
    expect(
      parseBoardParams(new URLSearchParams('q=inv&filter=agent&sort=name'))
    ).toEqual({ query: 'inv', filter: 'agent', sort: 'name' });
    expect(
      parseBoardParams(new URLSearchParams('filter=nope&sort=up'))
    ).toEqual({ query: '', filter: 'all', sort: 'updated' });
    expect(parseBoardParams(new URLSearchParams(''))).toEqual({
      query: '',
      filter: 'all',
      sort: 'updated',
    });
  });
});
