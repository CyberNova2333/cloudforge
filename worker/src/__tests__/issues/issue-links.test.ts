import { describe, expect, it } from 'vitest';
import { issueRefs } from '../../issues/links';

describe('拉取请求里的议题引用', () => {
  it('关闭关键字后的编号会关闭议题，其余只是提到', () => {
    expect(
      issueRefs('Fixes #1, closes: #2 and resolved #3. See #4 (#5).')
    ).toEqual([
      { number: 1, closes: true },
      { number: 2, closes: true },
      { number: 3, closes: true },
      { number: 4, closes: false },
      { number: 5, closes: false },
    ]);
  });

  it('关键字只作用于紧跟的编号，不区分大小写', () => {
    expect(issueRefs('FIX #7, #8\nfixed #9')).toEqual([
      { number: 7, closes: true },
      { number: 8, closes: false },
      { number: 9, closes: true },
    ]);
  });

  it('同一编号只出现一次，任一处是关闭关键字即关闭', () => {
    expect(issueRefs('See #3. Fixes #3')).toEqual([
      { number: 3, closes: true },
    ]);
  });

  it('忽略代码、单词中间、URL 与 HTML 实体里的 #', () => {
    expect(
      issueRefs(
        [
          'Fixes `#1`',
          '```',
          'fixes #2',
          '```',
          'abc#3 https://x.test/a#4 /#5 &#6; #7x #0 fixes #8-a',
        ].join('\n')
      )
    ).toEqual([]);
  });

  it('未闭合的代码块到文末为止', () => {
    expect(issueRefs('fixes #1\n```\nfixes #2')).toEqual([
      { number: 1, closes: true },
    ]);
  });
});
