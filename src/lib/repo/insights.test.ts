// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  barWidths,
  of,
  parsePeriod,
  pct,
  PERIOD_OPTIONS,
  rangeText,
  span,
} from './insights';

describe('parsePeriod：解析时段', () => {
  it('接受四种时段，默认 30 天', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod('30')).toBe(30);
    expect(parsePeriod('90')).toBe(90);
    expect(parsePeriod('365')).toBe(365);
    expect(parsePeriod(null)).toBe(30);
    expect(parsePeriod('14')).toBe(30);
    expect(parsePeriod('abc')).toBe(30);
  });
  it('列出时段及其文字标签', () => {
    expect(PERIOD_OPTIONS.map((o) => o.label)).toEqual([
      '1 week',
      '1 month',
      '3 months',
      '1 year',
    ]);
    expect(PERIOD_OPTIONS.map((o) => o.value)).toEqual([
      '7',
      '30',
      '90',
      '365',
    ]);
  });
});

describe('数字格式', () => {
  it('将比例显示为百分比，无值时显示短横线', () => {
    expect(pct(0.84)).toBe('84%');
    expect(pct(1)).toBe('100%');
    expect(pct(0)).toBe('0%');
    expect(pct(null)).toBe('—');
  });
  it('显示秒数时长或短横线', () => {
    expect(span(null)).toBe('—');
    expect(span(45)).toBe('45s');
    expect(span(720)).toBe('12m');
  });
  it('执行除法且避免除以零', () => {
    expect(of(3, 4)).toBe(0.75);
    expect(of(0, 0)).toBeNull();
  });
});

describe('barWidths：条形宽度', () => {
  it('提出数按最繁忙评审者缩放，批准数按提出数缩放', () => {
    expect(barWidths(42, 19, 42)).toEqual({
      raised: 100,
      approved: (19 / 42) * 100,
    });
    expect(barWidths(21, 21, 42)).toEqual({ raised: 50, approved: 100 });
  });
  it('没有提出问题时为空', () => {
    expect(barWidths(0, 0, 42)).toEqual({ raised: 0, approved: 0 });
    expect(barWidths(0, 0, 0)).toEqual({ raised: 0, approved: 0 });
  });
  it('不超出轨道宽度', () => {
    expect(barWidths(5, 9, 5)).toEqual({ raised: 100, approved: 100 });
  });
});

describe('rangeText：日期范围文字', () => {
  it('将时段显示为日期范围', () => {
    expect(
      rangeText('2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z')
    ).toBe('Oct 1, 2026 – Oct 8, 2026');
  });
  it('数据尚未返回时为空', () => {
    expect(rangeText(undefined, undefined)).toBe('');
  });
});
