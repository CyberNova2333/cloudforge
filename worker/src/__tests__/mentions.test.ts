import { describe, expect, it } from 'vitest';
import { mentionedUsernames } from '../lib/mentions';

describe('@ 提及', () => {
  it('读出被提到的用户名，统一小写、去重', () => {
    expect(
      mentionedUsernames('@Ada please look, cc @bob-smith and (@ada).')
    ).toEqual(['ada', 'bob-smith']);
    expect(mentionedUsernames('@carol: thanks\n@dave')).toEqual([
      'carol',
      'dave',
    ]);
  });

  it('不把代码、邮箱、单词中间和路径里的 @ 当作提及', () => {
    expect(
      mentionedUsernames(
        [
          'mail me at ada@example.com',
          '`@bob`',
          '```',
          '@carol',
          '```',
          'npm i @scope/pkg x@dave /@erin @-bad @frank_',
        ].join('\n')
      )
    ).toEqual([]);
  });
});
