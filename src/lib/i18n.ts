import { createElement, Fragment, type ReactNode } from 'react';
import { zh, zhPatterns } from '../locales/zh';

/**
 * UI language. The English text in the source is the key: `t('New repository')` shows the Chinese from
 * `src/locales/zh` when the language is Chinese and a translation exists, else the English as written.
 * The language comes from the person's choice (localStorage `go-lang`), else the browser's languages, and is
 * fixed for the page's life: switching reloads, so module-level constants built with `t()` are right too.
 */
export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'go-lang';

function detect(): Lang {
  try {
    const saved =
      typeof localStorage === 'undefined'
        ? null
        : localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Blocked storage: fall through to the browser's languages.
  }
  const langs =
    typeof navigator === 'undefined' || !navigator.languages
      ? []
      : navigator.languages;
  return langs.some((l) => l.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

export const lang: Lang = detect();

/** BCP 47 tag for `Intl` and `<html lang>`. */
export const locale = lang === 'zh' ? 'zh-CN' : 'en';

if (typeof document !== 'undefined') document.documentElement.lang = locale;

/** Stores the choice and reloads, so every string (including module-level ones) is rebuilt. */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Blocked storage: the reload falls back to the browser's languages.
  }
  location.reload();
}

type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m
  );
}

/** The text of `key` (English, with `{name}` placeholders) in the UI language, placeholders filled. */
export function t(key: string, vars?: Vars): string {
  return fill((lang === 'zh' && zh[key]) || key, vars);
}

/** `t` for a count: `one` when n is 1, else `other`; `{n}` is the count. Chinese has one form for both. */
export function tn(n: number, one: string, other: string, vars?: Vars) {
  return t(n === 1 ? one : other, { n, ...vars });
}

/**
 * `t` for text with elements in it: `tx('Use a {link} as your password.', { link: <Link …>token</Link> })`.
 * Each `{name}` becomes that node, so a translation can move it where the language puts it.
 */
export function tx(key: string, parts: Record<string, ReactNode>): ReactNode {
  const text = (lang === 'zh' && zh[key]) || key;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in parts)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(createElement(Fragment, { key: out.length }, parts[m[1]]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return createElement(Fragment, null, ...out);
}

/**
 * A message from the server (an API error) in the UI language: an exact entry in the dictionary, else the
 * first pattern that matches, else the message as sent.
 */
export function tServer(message: string): string {
  if (lang !== 'zh') return message;
  if (zh[message]) return zh[message];
  for (const [pattern, text] of zhPatterns) {
    const m = message.match(pattern);
    if (m) return text.replace(/\$(\d)/g, (_, i: string) => m[Number(i)]);
  }
  return message;
}
