// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  highlightHunkLines,
  highlightLines,
  splitHtmlLines,
} from './highlight';
import { languageFor } from '../i18n/languages';

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const balanced = (html: string) =>
  (html.match(/<span/g) ?? []).length ===
  (html.match(/<\/span>/g) ?? []).length;

describe('languageFor：识别语言', () => {
  it('检测常见扩展名和特殊文件名', () => {
    expect(languageFor('src/App.tsx')).toBe('typescript');
    expect(languageFor('main.py')).toBe('python');
    expect(languageFor('a/b/Dockerfile')).toBe('dockerfile');
    expect(languageFor('Makefile')).toBe('makefile');
    expect(languageFor('config.yml')).toBe('yaml');
    expect(languageFor('LICENSE')).toBeNull();
    expect(languageFor('notes.unknownext')).toBeNull();
  });
});

describe('highlightLines：逐行高亮', () => {
  it('为每行源码返回结构完整的一行，并保留文本', () => {
    const code =
      'def greet(name):\n    """Say\n    hello."""\n    return f"Hi {name}"\n';
    const lines = highlightLines(code, 'python')!;
    expect(lines).toHaveLength(code.split('\n').length);
    lines.forEach((l, i) => {
      expect(balanced(l)).toBe(true);
      expect(text(l)).toBe(code.split('\n')[i]);
    });
    // The docstring spans lines 2-3; both lines must carry the string color.
    expect(lines[1]).toContain('hljs-string');
    expect(lines[2]).toContain('hljs-string');
  });

  it('转义源码中的 HTML', () => {
    const lines = highlightLines(
      'const x = "<img src=x onerror=alert(1)>";',
      'javascript'
    )!;
    expect(lines[0]).not.toContain('<img');
    expect(lines[0]).toContain('&lt;img');
  });

  it('不处理未知语言', () => {
    expect(highlightLines('x', 'not-a-language')).toBeNull();
  });
});

describe('splitHtmlLines：拆分 HTML 行', () => {
  it('跨行的 span 在下一行重新打开', () => {
    expect(splitHtmlLines('<span class="a">x\ny</span>z')).toEqual([
      '<span class="a">x</span>',
      '<span class="a">y</span>z',
    ]);
  });
});

describe('highlightHunkLines：差异块逐行高亮', () => {
  it('按差异各侧的源码为每行着色，并将差异标记排除在代码外', () => {
    const lines = [
      ' /* start of a',
      '-   old comment */',
      '+   new comment */',
      ' const a = 1;',
    ];
    const html = highlightHunkLines(lines, 'javascript');
    expect(html.map((h) => text(h!))).toEqual([
      '/* start of a',
      '   old comment */',
      '   new comment */',
      'const a = 1;',
    ]);
    expect(html[1]).toContain('hljs-comment');
    expect(html[2]).toContain('hljs-comment');
    expect(html[3]).toContain('hljs-keyword');
  });
});
