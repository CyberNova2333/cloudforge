/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { zh, zhAreas, zhPatterns } from '../locales/zh';

// Every source file of the app, as text (Vite inlines them at transform time; no file system needed). Not
// i18n.ts itself: its comments show example keys.
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob(
      ['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../locales/**'],
      { query: '?raw', import: 'default', eager: true }
    ) as Record<string, string>
  ).filter(([file]) => !file.endsWith('/i18n.ts'))
);

const STR = String.raw`(['"])((?:\\.|(?!\1)[^\\])*)\1`;
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

/** Every literal key passed to t / tx (first argument) and tn (second and third). */
function keysIn(src: string): string[] {
  const keys: string[] = [];
  for (const m of src.matchAll(new RegExp(String.raw`\bt[x]?\(\s*${STR}`, 'g')))
    keys.push(unescape(m[2]));
  const tn = new RegExp(
    String.raw`\btn\(\s*[^,]+,\s*${STR}\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3`,
    'g'
  );
  for (const m of src.matchAll(tn)) keys.push(unescape(m[2]), unescape(m[4]));
  return keys;
}

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('中文界面文案', () => {
  it('翻译应用使用的所有键', () => {
    const missing: string[] = [];
    for (const [file, src] of Object.entries(sources))
      for (const key of keysIn(src))
        if (!(key in zh)) missing.push(`${file}: ${key}`);
    expect(missing).toEqual([]);
  });

  it('不在运行时拼接翻译键，模板字面量不用于翻译', () => {
    const dynamic = Object.entries(sources).flatMap(([file, src]) =>
      [...src.matchAll(/\bt[xn]?\(\s*`/g)].map(() => file)
    );
    expect(dynamic).toEqual([]);
  });

  it('翻译保留所有占位符', () => {
    const broken = Object.entries(zh)
      .filter(([en, cn]) => placeholders(en).join() !== placeholders(cn).join())
      .map(([en, cn]) => `${en} → ${cn}`);
    expect(broken).toEqual([]);
  });

  it('多个区域共用的键采用同一译文', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [area, table] of Object.entries(zhAreas))
      for (const [en, cn] of Object.entries(table)) {
        const before = seen.get(en);
        if (before !== undefined && before !== cn)
          clashes.push(`${area}: ${en} → ${cn}（其他区域为 ${before}）`);
        seen.set(en, cn);
      }
    expect(clashes).toEqual([]);
  });

  it('根据捕获组填充服务端消息模式', () => {
    const [pattern, text] = zhPatterns.find(([p]) =>
      p.test('Request failed: 502')
    )!;
    const m = 'Request failed: 502'.match(pattern)!;
    expect(text.replace(/\$(\d)/g, (_, i: string) => m[Number(i)])).toBe(
      '请求失败：502'
    );
  });
});
