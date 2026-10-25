import { describe, expect, it } from 'vitest';
import {
  issuesHref,
  issueTimeline,
  labelInk,
  normalizeColor,
  parseIssuesView,
} from './issuesView';
import type { Comment, IssueEvent } from './uiApi';

const user = { id: 'u', username: 'ada', name: 'Ada', image: null };

describe('议题列表的地址', () => {
  it('解析筛选条件，缺失或不合法时取默认值', () => {
    expect(parseIssuesView(new URLSearchParams(''))).toEqual({
      state: 'open',
      q: '',
      label: '',
      assignee: '',
      page: 1,
    });
    expect(
      parseIssuesView(
        new URLSearchParams(
          'state=closed&q=%20crash%20&label=bug&assignee=none&page=3'
        )
      )
    ).toEqual({
      state: 'closed',
      q: 'crash',
      label: 'bug',
      assignee: 'none',
      page: 3,
    });
    expect(
      parseIssuesView(new URLSearchParams('state=merged&page=-2')).state
    ).toBe('open');
    expect(parseIssuesView(new URLSearchParams('page=1.5')).page).toBe(1);
  });

  it('生成地址时省略默认值', () => {
    expect(issuesHref('/o/r')).toBe('/o/r/issues');
    expect(issuesHref('/o/r', { state: 'open', page: 1, q: ' ' })).toBe(
      '/o/r/issues'
    );
    expect(
      issuesHref('/o/r', { state: 'all', label: 'good first', page: 2 })
    ).toBe('/o/r/issues?state=all&label=good+first&page=2');
  });
});

describe('标记的颜色', () => {
  it('统一为六位小写十六进制', () => {
    expect(normalizeColor('#D73A4A')).toBe('d73a4a');
    expect(normalizeColor(' 0e8a16 ')).toBe('0e8a16');
    expect(normalizeColor('#fff')).toBeNull();
    expect(normalizeColor('zzzzzz')).toBeNull();
  });

  it('浅色标记用深色文字，深色标记用白色文字', () => {
    expect(labelInk('fef2c0')).toBe('#1f2328');
    expect(labelInk('ededed')).toBe('#1f2328');
    expect(labelInk('24292f')).toBe('#ffffff');
    expect(labelInk('5319e7')).toBe('#ffffff');
    // Not a colour: treated as black.
    expect(labelInk('nope')).toBe('#ffffff');
  });
});

describe('议题的时间线', () => {
  it('评论与事件按时间排序，同一时刻事件在前', () => {
    const comment = (id: string, at: string): Comment => ({
      id,
      author: user,
      body: id,
      createdAt: at,
      updatedAt: at,
    });
    const event = (id: string, at: string): IssueEvent => ({
      id,
      kind: 'labeled',
      actor: user,
      user: null,
      data: {},
      createdAt: at,
    });
    const list = issueTimeline(
      [
        comment('c1', '2026-10-01T10:00:00Z'),
        comment('c2', '2026-10-01T12:00:00Z'),
      ],
      [event('e1', '2026-10-01T11:00:00Z'), event('e2', '2026-10-01T12:00:00Z')]
    );
    expect(
      list.map((e) => (e.kind === 'comment' ? e.comment.id : e.event.id))
    ).toEqual(['c1', 'e1', 'e2', 'c2']);
  });
});
