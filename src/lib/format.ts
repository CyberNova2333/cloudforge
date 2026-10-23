// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { lang, locale, t } from './i18n';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];
const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

export function timeAgo(input: string | number | Date): string {
  const date =
    typeof input === 'number' ? new Date(input * 1000) : new Date(input);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return t('now');
  for (const [unit, s] of UNITS) {
    if (Math.abs(seconds) >= s)
      return rtf.format(Math.round(seconds / s), unit);
  }
  return t('now');
}

export function fullDate(input: string | number): string {
  const date =
    typeof input === 'number' ? new Date(input * 1000) : new Date(input);
  return date.toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function dayLabel(input: number): string {
  return new Date(input * 1000).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const shortSha = (sha: string) => sha.slice(0, 7);

export function firstLine(message: string) {
  const i = message.indexOf('\n');
  return i < 0 ? message : message.slice(0, i);
}

export function restOfMessage(message: string) {
  const i = message.indexOf('\n');
  return i < 0 ? '' : message.slice(i + 1).trim();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} Bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const UNIT_ZH = { s: '秒', m: '分', h: '小时', d: '天' } as const;

/** `n` with a short unit: `45s` in English, `45秒` in Chinese. */
function unit(n: number, u: keyof typeof UNIT_ZH) {
  return lang === 'zh' ? `${n}${UNIT_ZH[u]}` : `${n}${u}`;
}

/** Two units side by side: `3h 4m`, or `3小时4分` in Chinese. */
const pair = (a: string, b: string) => (lang === 'zh' ? a + b : `${a} ${b}`);

/** A span of seconds in its two largest units: `45s`, `12m`, `3h 4m`, `2d 5h`. */
export function spanOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return unit(s, 's');
  const m = Math.floor(s / 60);
  if (m < 60) return unit(m, 'm');
  const h = Math.floor(m / 60);
  if (h < 24)
    return m % 60 ? pair(unit(h, 'h'), unit(m % 60, 'm')) : unit(h, 'h');
  const d = Math.floor(h / 24);
  return h % 24 ? pair(unit(d, 'd'), unit(h % 24, 'h')) : unit(d, 'd');
}

/** GitHub-style elapsed time between two instants: `45s`, `3m 12s`, `1h 4m`. */
export function duration(
  start: string | null,
  end: string | null,
  now = Date.now()
): string {
  if (!start) return '';
  const ms = (end ? new Date(end).getTime() : now) - new Date(start).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return unit(s, 's');
  const m = Math.floor(s / 60);
  if (m < 60) return pair(unit(m, 'm'), unit(s % 60, 's'));
  return pair(unit(Math.floor(m / 60), 'h'), unit(m % 60, 'm'));
}
