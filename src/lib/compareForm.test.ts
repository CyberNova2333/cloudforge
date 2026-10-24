// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  compareHref,
  comparison,
  parseRange,
  prefillTitle,
} from './compareForm';
import type { Commit, Compare } from './uiApi';

describe('parseRange：解析比较范围', () => {
  it('从 base...head 中读取基础分支和头分支', () => {
    expect(parseRange('main...feature/x', 'main')).toEqual({
      base: 'main',
      head: 'feature/x',
    });
    expect(parseRange('release...claude/s4-usd', 'main')).toEqual({
      base: 'release',
      head: 'claude/s4-usd',
    });
  });

  it('单个分支作为头分支，与默认分支比较', () => {
    expect(parseRange('feature/x', 'main')).toEqual({
      base: 'main',
      head: 'feature/x',
    });
  });

  it('缺少基础分支时使用默认分支，缺少头分支时保持为空', () => {
    expect(parseRange('...feature', 'main')).toEqual({
      base: 'main',
      head: 'feature',
    });
    expect(parseRange('main...', 'main')).toEqual({ base: 'main', head: '' });
    expect(parseRange('', 'main')).toEqual({ base: 'main', head: '' });
  });
});

describe('compareHref：比较链接', () => {
  it('将比较范围写在仓库路径之后', () => {
    expect(compareHref('/o/r', 'main', 'claude/s4-usd')).toBe(
      '/o/r/compare/main...claude/s4-usd'
    );
  });
});

const commit = (message: string): Commit =>
  ({ hash: 'a'.repeat(40), message }) as Commit;

describe('prefillTitle：预填标题', () => {
  it('单个提交使用提交消息的首行', () => {
    expect(
      prefillTitle([commit('Bill in US dollars\n\nMore detail.')], 'x')
    ).toBe('Bill in US dollars');
  });

  it('多个提交时根据分支名生成标题', () => {
    expect(
      prefillTitle([commit('a'), commit('b')], 'claude/s4-usd_invoices')
    ).toBe('Claude s4 usd invoices');
  });

  it('没有提交时根据分支名生成标题', () => {
    expect(prefillTitle([], 'rate-limit')).toBe('Rate limit');
  });
});

const cmp = (extra: Partial<Compare>): Compare => ({
  baseSha: 'b',
  headSha: 'h',
  status: 'ahead',
  mergeable: true,
  conflicts: [],
  commits: [commit('x')],
  files: [],
  ...extra,
});

describe('比较状态', () => {
  it('有领先提交时准备就绪', () => {
    expect(comparison(cmp({}))).toMatchObject({
      ready: true,
      canRebase: true,
      conflicts: false,
    });
  });

  it('无提交或头分支落后时没有可比较内容', () => {
    expect(comparison(cmp({ commits: [] })).ready).toBe(false);
    expect(comparison(cmp({ status: 'behind' })).ready).toBe(false);
    expect(comparison(cmp({ status: 'identical', commits: [] })).ready).toBe(
      false
    );
  });

  it('可合并或仅领先时说明可以变基', () => {
    expect(
      comparison(cmp({ status: 'diverged', mergeable: true })).canRebase
    ).toBe(true);
    expect(
      comparison(cmp({ status: 'ahead', mergeable: false })).canRebase
    ).toBe(true);
  });

  it('存在冲突时说明无法自动变基', () => {
    expect(
      comparison(
        cmp({ status: 'diverged', mergeable: false, conflicts: ['a.ts'] })
      )
    ).toMatchObject({ canRebase: false, conflicts: true, ready: true });
  });

  it('既不可合并也无冲突时不作判断', () => {
    expect(
      comparison(cmp({ status: 'diverged', mergeable: false, conflicts: [] }))
    ).toMatchObject({ canRebase: false, conflicts: false });
  });
});
