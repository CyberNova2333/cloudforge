// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  anchoredReviewer,
  earlierEntries,
  earlierVerb,
  reviewEntries,
  reviewTime,
  reviewVerb,
  slotOf,
  timelineSlots,
} from './reviewTimeline';
import type { ReviewerStatus } from './uiApi';

type R = {
  id: string;
  status: ReviewerStatus;
  requested: boolean;
  createdAt: string;
  finishedAt: string | null;
  flags: { approvedAt: string | null }[];
};
const r = (over: Partial<R> & { id: string }): R => ({
  status: 'approved',
  requested: true,
  createdAt: '2026-01-01T10:00:00Z',
  finishedAt: '2026-01-01T10:05:00Z',
  flags: [],
  ...over,
});
/** A reviewer the conversation shows (never `not_needed`). */
const shown = (
  over: Partial<R> & {
    id: string;
    status: Exclude<ReviewerStatus, 'not_needed'>;
  }
) => ({ ...r(over), status: over.status });
const flag = (approvedAt: string | null = null) => ({ approvedAt });

describe('reviewVerb：评审描述', () => {
  it('表达方式与人工评审一致', () => {
    expect(reviewVerb(shown({ id: 'a', status: 'approved' }))).toBe(
      'approved these changes'
    );
    expect(reviewVerb(shown({ id: 'a', status: 'changes_requested' }))).toBe(
      'requested changes'
    );
    expect(reviewVerb(shown({ id: 'a', status: 'reviewing' }))).toBe(
      'is reviewing…'
    );
    expect(reviewVerb(shown({ id: 'a', status: 'failed' }))).toBe(
      'couldn’t finish its review'
    );
  });
  it('仅统计仍等待人工处理的问题', () => {
    expect(
      reviewVerb(shown({ id: 'a', status: 'flagged', flags: [flag()] }))
    ).toBe('flagged 1 finding for a person');
    expect(
      reviewVerb(
        shown({
          id: 'a',
          status: 'flagged',
          flags: [flag(), flag('x'), flag()],
        })
      )
    ).toBe('flagged 2 findings for a person');
  });
  it('所有问题均获人工批准后说明情况', () => {
    expect(
      reviewVerb(shown({ id: 'a', status: 'flagged', flags: [flag('x')] }))
    ).toBe('flagged 1 finding, approved');
    expect(
      reviewVerb(
        shown({ id: 'a', status: 'flagged', flags: [flag('x'), flag('y')] })
      )
    ).toBe('flagged 2 findings, all approved');
  });
});

describe('reviewTime：评审时间', () => {
  it('使用完成时间，评审中则使用开始时间', () => {
    expect(reviewTime(r({ id: 'a' }))).toBe('2026-01-01T10:05:00Z');
    expect(
      reviewTime(r({ id: 'a', status: 'reviewing', finishedAt: null }))
    ).toBe('2026-01-01T10:00:00Z');
    expect(reviewTime(r({ id: 'a', finishedAt: null }))).toBe(
      '2026-01-01T10:00:00Z'
    );
  });
});

describe('reviewEntries：评审条目', () => {
  it('仅保留被请求的代理，排除已取消者', () => {
    const list = [
      r({ id: 'a' }),
      r({ id: 'b', requested: false, status: 'not_needed' }),
      r({ id: 'c', requested: true, status: 'not_needed' }),
      r({ id: 'd', status: 'reviewing' }),
    ];
    expect(reviewEntries(list).map((x) => x.id)).toEqual(['a', 'd']);
  });
});

describe('timelineSlots：时间线位置', () => {
  const c = (createdAt: string) => ({ createdAt });
  const e = (id: string, createdAt: string) => ({ id, createdAt });
  it('按时间顺序将事件和评审插入其发生时相邻的评论之间', () => {
    const comments = [c('2026-01-01T09:00:00Z'), c('2026-01-01T11:00:00Z')];
    const events = [
      e('push1', '2026-01-01T08:00:00Z'),
      e('push2', '2026-01-01T10:30:00Z'),
    ];
    const reviews = [
      r({
        id: 'old',
        createdAt: '2026-01-01T08:01:00Z',
        finishedAt: '2026-01-01T08:10:00Z',
      }),
      r({
        id: 'new',
        createdAt: '2026-01-01T10:31:00Z',
        finishedAt: null,
        status: 'reviewing',
      }),
      r({
        id: 'late',
        createdAt: '2026-01-01T10:31:00Z',
        finishedAt: '2026-01-01T12:00:00Z',
      }),
    ];
    const slots = timelineSlots(comments, events, reviews);
    const ids = slots.map((s) =>
      s.map((x) => (x.kind === 'event' ? x.event.id : x.review.id))
    );
    expect(ids).toEqual([['push1', 'old'], ['push2', 'new'], ['late']]);
  });
  it('同一时刻的事件排在评审之前', () => {
    const slots = timelineSlots(
      [],
      [e('push', '2026-01-01T10:05:00Z')],
      [r({ id: 'a' })]
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].map((x) => x.kind)).toEqual(['event', 'review']);
  });
  it('没有评审时保留事件原顺序', () => {
    const slots = timelineSlots(
      [c('2026-01-01T09:00:00Z')],
      [e('a', '2026-01-01T08:00:00Z'), e('b', '2026-01-01T08:00:00Z')],
      []
    );
    expect(slots[0].map((x) => (x.kind === 'event' ? x.event.id : ''))).toEqual(
      ['a', 'b']
    );
    expect(slots[1]).toEqual([]);
  });
});

describe('较早提交的评审', () => {
  const c = (createdAt: string) => ({ createdAt });
  const p = (
    id: string,
    finishedAt: string | null,
    status: ReviewerStatus = 'flagged'
  ) => ({
    id,
    headSha: 'abc1234',
    status,
    createdAt: '2026-01-01T07:00:00Z',
    finishedAt,
    flags: [flag()],
  });
  it('按各自时间插入评论、事件和当前提交评审之间', () => {
    const slots = timelineSlots(
      [c('2026-01-01T09:00:00Z')],
      [{ id: 'push', createdAt: '2026-01-01T08:30:00Z' }],
      [r({ id: 'head' })],
      [p('old', '2026-01-01T08:00:00Z'), p('unfinished', null)]
    );
    const ids = slots.map((s) =>
      s.map((x) => `${x.kind}:${x.kind === 'event' ? x.event.id : x.review.id}`)
    );
    expect(ids).toEqual([
      ['earlier:unfinished', 'earlier:old', 'event:push'],
      ['review:head'],
    ]);
  });
  it('即使有未关闭的问题，也不作为查看问题的定位目标', () => {
    const slots = timelineSlots(
      [],
      [],
      [r({ id: 'head' })],
      [p('old', '2026-01-01T08:00:00Z')]
    );
    expect(anchoredReviewer(slots)).toBe(null);
    const both = timelineSlots(
      [],
      [],
      [r({ id: 'head', flags: [flag()] })],
      [p('old', '2026-01-01T08:00:00Z')]
    );
    expect(anchoredReviewer(both)).toBe('head');
  });
  it('排除已取消的评审', () => {
    expect(
      earlierEntries([
        p('a', null),
        p('b', null, 'not_needed'),
        p('c', null, 'failed'),
      ]).map((x) => x.id)
    ).toEqual(['a', 'c']);
  });
  it('统计所有问题，因为它们都不再等待处理', () => {
    expect(earlierVerb({ status: 'flagged', flags: [flag(), flag('x')] })).toBe(
      'flagged 2 findings'
    );
    expect(earlierVerb({ status: 'approved', flags: [] })).toBe(
      'approved these changes'
    );
  });
});

describe('anchoredReviewer：定位的评审者', () => {
  it('选择时间线中首个包含待人工处理问题的评审', () => {
    const slots = timelineSlots(
      [c2('2026-01-01T10:02:00Z')],
      [],
      [
        r({
          id: 'done',
          flags: [flag('x')],
          finishedAt: '2026-01-01T10:01:00Z',
        }),
        r({ id: 'later', flags: [flag()], finishedAt: '2026-01-01T10:09:00Z' }),
        r({
          id: 'earlier',
          flags: [flag()],
          finishedAt: '2026-01-01T10:03:00Z',
        }),
      ]
    );
    expect(anchoredReviewer(slots)).toBe('earlier');
  });
  it('没有待人工处理的问题时返回 null', () => {
    expect(anchoredReviewer(timelineSlots([], [], [r({ id: 'a' })]))).toBe(
      null
    );
  });
});
function c2(createdAt: string) {
  return { createdAt };
}

describe('slotOf：查找时间线位置', () => {
  it('返回首个较晚评论的位置，或所有评论之后的位置', () => {
    const comments = [{ createdAt: '2026-01-01T09:00:00Z' }];
    expect(slotOf(comments, '2026-01-01T08:00:00Z')).toBe(0);
    expect(slotOf(comments, '2026-01-01T09:00:00Z')).toBe(1);
    expect(slotOf([], '2026-01-01T08:00:00Z')).toBe(0);
  });
});
