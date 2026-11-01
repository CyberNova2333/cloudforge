import { describe, expect, it } from 'vitest';
import { markedWithRefs } from './issueRefs';

const render = (md: string) =>
  markedWithRefs('/o/r').parse(md, { async: false }) as string;
const link = (n: number) =>
  `<a href="/o/r/issues/${n}" data-repo-link="">#${n}</a>`;

describe('Markdown 里的 #N 链接', () => {
  it('把 #N 链接到议题（拉取请求从那里跳转）', () => {
    expect(render('Fixes #12, see (#3).')).toBe(
      `<p>Fixes ${link(12)}, see (${link(3)}).</p>\n`
    );
    expect(render('#7 first')).toBe(`<p>${link(7)} first</p>\n`);
  });

  it('不链接单词中间、URL、HTML 实体、代码和已有链接里的 #', () => {
    for (const md of [
      'abc#12',
      'https://x.test/a#4',
      'see /#5',
      '`#6`',
      '#0',
      '#8x',
      '[#9](https://x.test)',
    ])
      expect(render(md)).not.toContain('/o/r/issues/');
    expect(render('```\n#10\n```')).not.toContain('/o/r/issues/');
  });
});
