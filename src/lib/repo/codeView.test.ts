// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  inLineRange,
  isMarkdownPath,
  nextLineHash,
  encodeRepoPath,
  parentPath,
  parseLineHash,
  pathCrumbs,
  splitFrontmatter,
  splitLines,
} from './codeView';

describe('parseLineHash：解析行号锚点', () => {
  it('读取单行和行范围', () => {
    expect(parseLineHash('#L12')).toEqual({ start: 12, end: 12 });
    expect(parseLineHash('#L12-L20')).toEqual({ start: 12, end: 20 });
  });
  it('将反向范围排序', () => {
    expect(parseLineHash('#L20-L12')).toEqual({ start: 12, end: 20 });
  });
  it('忽略其他内容', () => {
    expect(parseLineHash('')).toBeNull();
    expect(parseLineHash('#diff-a')).toBeNull();
    expect(parseLineHash('#L0')).toBeNull();
    expect(parseLineHash('#L1-')).toBeNull();
    expect(parseLineHash('#Lx')).toBeNull();
  });
});

describe('nextLineHash：下一个行号锚点', () => {
  it('选中被点击的行', () => {
    expect(nextLineHash(null, 5, false)).toBe('#L5');
    expect(nextLineHash({ start: 2, end: 3 }, 5, false)).toBe('#L5');
  });
  it('按住 Shift 点击时从已选行扩展', () => {
    expect(nextLineHash({ start: 5, end: 5 }, 9, true)).toBe('#L5-L9');
    expect(nextLineHash({ start: 5, end: 5 }, 2, true)).toBe('#L2-L5');
    expect(nextLineHash({ start: 5, end: 8 }, 9, true)).toBe('#L5-L9');
  });
  it('未选中行时按住 Shift 点击仅选择当前行', () => {
    expect(nextLineHash(null, 4, true)).toBe('#L4');
  });
});

describe('inLineRange：判断行范围', () => {
  it('包含两端', () => {
    const r = { start: 3, end: 5 };
    expect([2, 3, 4, 5, 6].map((n) => inLineRange(r, n))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(inLineRange(null, 3)).toBe(false);
  });
});

describe('splitLines：拆分行', () => {
  it('仅移除末尾换行符之后的空行', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a')).toEqual(['a']);
  });
});

describe('路径', () => {
  it('将路径显示为从根目录开始的链接', () => {
    expect(pathCrumbs('/o/r', 'main', 'src/lib/a.ts')).toEqual([
      { label: 'src', to: '/o/r/tree/main/src' },
      { label: 'lib', to: '/o/r/tree/main/src/lib' },
      { label: 'a.ts', to: null },
    ]);
    expect(pathCrumbs('/o/r', 'main', '')).toEqual([]);
  });
  it('编码路径分段而非斜杠', () => {
    expect(encodeRepoPath('a b/c#d/e?.md')).toBe('a%20b/c%23d/e%3F.md');
    expect(encodeRepoPath('src/lib/a.ts')).toBe('src/lib/a.ts');
    expect(pathCrumbs('/o/r', 'main', 'a b/c#d/e.md')[1]).toEqual({
      label: 'c#d',
      to: '/o/r/tree/main/a%20b/c%23d',
    });
  });
  it('找到父目录', () => {
    expect(parentPath('a/b/c')).toBe('a/b');
    expect(parentPath('a')).toBe('');
    expect(parentPath('')).toBe('');
  });
  it('识别 Markdown 文件', () => {
    expect(isMarkdownPath('README.md')).toBe(true);
    expect(isMarkdownPath('a/b.markdown')).toBe(true);
    expect(isMarkdownPath('README')).toBe(false);
    expect(isMarkdownPath('x.mdx')).toBe(false);
  });
});

describe('splitFrontmatter：拆分前置元数据', () => {
  it('分离开头的 YAML 块', () => {
    const r = splitFrontmatter('---\nname: A\nbio: B\n---\n\n# Body\n');
    expect(r.frontmatter).toBe('name: A\nbio: B');
    expect(r.body).toBe('# Body\n');
  });
  it('不将以水平分隔线开头的 README 误判为元数据', () => {
    const text = '---\n\n# Title\n\nIntro.\n\n---\n\nMore';
    expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
    const prose = '---\nSome text\n---\n\nMore';
    expect(splitFrontmatter(prose)).toEqual({ frontmatter: null, body: prose });
  });
  it('要求块内容以键开头', () => {
    expect(splitFrontmatter('---\ntitle: A\n---\nB').frontmatter).toBe(
      'title: A'
    );
    expect(splitFrontmatter('---\n"quoted key": 1\n---\nB').frontmatter).toBe(
      '"quoted key": 1'
    );
  });
  it('跳过代理设置开头的注释行', () => {
    const r = splitFrontmatter(
      '---\n# Shown on the profile at /securityagent. Edit this file.\n\nname: "Security"\ntrigger:\n  above: 0.4\n---\n\n# Security\n'
    );
    expect(r.frontmatter).toBe(
      '# Shown on the profile at /securityagent. Edit this file.\n\nname: "Security"\ntrigger:\n  above: 0.4'
    );
    expect(r.body).toBe('# Security\n');
  });
  it('不将以分隔线、标题和类似键的行开头的 README 误判为元数据', () => {
    const text = '---\n\n# Title\n\nNote: this is a draft.\n\n---\n\nMore';
    expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });
  it('要求块内每行都符合 YAML 语法', () => {
    const text = '---\nname: A\nSome prose in the middle.\n---\nBody';
    expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });
  it('接受列表、嵌套键和缩进注释', () => {
    const r = splitFrontmatter(
      '---\n# note\nname: A\ntrigger:\n  # why\n  ask: B\ntags:\n- one\n- two\n---\nBody'
    );
    expect(r.frontmatter).toBe(
      '# note\nname: A\ntrigger:\n  # why\n  ask: B\ntags:\n- one\n- two'
    );
    expect(r.body).toBe('Body');
  });
  it('不将仅包含注释的块误判为元数据', () => {
    const text = '---\n# just a note\n---\n\nBody';
    expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });
  it('文档未以前置元数据开头时保持原样', () => {
    const text = '# Title\n\n---\n\ntext';
    expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });
  it('必须存在结束行', () => {
    const text = '---\nname: A\nno end';
    expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
  });
  it('处理 Windows 换行符', () => {
    const r = splitFrontmatter('---\r\na: 1\r\n---\r\nBody');
    expect(r.frontmatter).toBe('a: 1');
    expect(r.body).toBe('Body');
  });
});
