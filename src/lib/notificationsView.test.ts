import { describe, expect, it } from 'vitest';
import { notificationsHref, parseNotificationsView } from './notificationsView';

describe('收件箱的地址', () => {
  it('解析筛选条件，不合法的取默认值', () => {
    expect(parseNotificationsView(new URLSearchParams(''))).toEqual({
      filter: 'unread',
      reason: '',
      repo: '',
      page: 1,
    });
    expect(
      parseNotificationsView(
        new URLSearchParams('filter=all&reason=mention&repo=o/r&page=2')
      )
    ).toEqual({ filter: 'all', reason: 'mention', repo: 'o/r', page: 2 });
    expect(
      parseNotificationsView(new URLSearchParams('reason=x&repo=bad&page=0'))
    ).toEqual({ filter: 'unread', reason: '', repo: '', page: 1 });
  });

  it('生成地址时省略默认值', () => {
    expect(notificationsHref()).toBe('/notifications');
    expect(notificationsHref({ filter: 'unread', page: 1 })).toBe(
      '/notifications'
    );
    expect(
      notificationsHref({
        filter: 'all',
        reason: 'assign',
        repo: 'o/r',
        page: 3,
      })
    ).toBe('/notifications?filter=all&reason=assign&repo=o%2Fr&page=3');
  });
});
