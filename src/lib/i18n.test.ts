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

describe('Chinese UI text', () => {
  it('translates every key the app uses', () => {
    const missing: string[] = [];
    for (const [file, src] of Object.entries(sources))
      for (const key of keysIn(src))
        if (!(key in zh)) missing.push(`${file}: ${key}`);
    expect(missing).toEqual([]);
  });

  it('never builds a key at run time (a template literal is never translated)', () => {
    const dynamic = Object.entries(sources).flatMap(([file, src]) =>
      [...src.matchAll(/\bt[xn]?\(\s*`/g)].map(() => file)
    );
    expect(dynamic).toEqual([]);
  });

  it('keeps every placeholder in the translation', () => {
    const broken = Object.entries(zh)
      .filter(([en, cn]) => placeholders(en).join() !== placeholders(cn).join())
      .map(([en, cn]) => `${en} → ${cn}`);
    expect(broken).toEqual([]);
  });

  it('gives a key shared by several areas the same translation', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [area, table] of Object.entries(zhAreas))
      for (const [en, cn] of Object.entries(table)) {
        const before = seen.get(en);
        if (before !== undefined && before !== cn)
          clashes.push(`${area}: ${en} → ${cn} (elsewhere ${before})`);
        seen.set(en, cn);
      }
    expect(clashes).toEqual([]);
  });

  it('fills server message patterns from their groups', () => {
    const [pattern, text] = zhPatterns.find(([p]) =>
      p.test('Request failed: 502')
    )!;
    const m = 'Request failed: 502'.match(pattern)!;
    expect(text.replace(/\$(\d)/g, (_, i: string) => m[Number(i)])).toBe(
      '请求失败：502'
    );
  });
});
