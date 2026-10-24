// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { SPARK_PAD, sparkGeometry } from './spark';

/** How the sparkline placed its points before it could have gaps. */
function original(values: number[], width: number, height: number) {
  const pad = 3;
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const last = series.length - 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / last;
  const y = (v: number) =>
    height - pad - ((v - min) / span) * (height - pad * 2);
  return series.map((v, i) => ({ x: x(i), y: y(v) }));
}

describe('sparkGeometry：无空缺的迷你图几何', () => {
  it.each([
    [[1, 2, 3, 2, 5, 4, 6, 3]],
    [[0, 0, 0, 0]],
    [[5]],
    [[2, 9]],
    [[262, 250, 255, 240, 236, 230, 210, 180]],
  ])('保持原有坐标计算：%j', (values) => {
    const g = sparkGeometry({ values, width: 104, height: 28 });
    expect(g.points.map(({ x, y }) => ({ x, y }))).toEqual(
      original(values, 104, 28)
    );
    // One run joining every point, nothing missing.
    expect(g.runs).toHaveLength(1);
    expect(g.runs[0]).toEqual(g.points);
    expect(g.points.some((p) => p.missing)).toBe(false);
    expect(g.last).toBe(g.points.length - 1);
    expect(g.baseline).toBe(28 - SPARK_PAD);
  });

  it('缺失列表未提供或全为 false 时结果相同', () => {
    const values = [3, 1, 2];
    const a = sparkGeometry({ values, width: 100, height: 30 });
    const b = sparkGeometry({
      values,
      missing: [false, false, false],
      width: 100,
      height: 30,
    });
    expect(b).toEqual(a);
  });
});

describe('sparkGeometry：包含未测量值的迷你图几何', () => {
  const values = [0, 0, 40, 0, 20, 0, 0, 10];
  const missing = [true, true, false, true, false, true, true, false];

  it('每个空缺处断开折线，线段仅包含连续测量点', () => {
    const g = sparkGeometry({ values, missing, width: 104, height: 28 });
    expect(g.runs.map((r) => r.map((p) => p.i))).toEqual([[2], [4], [7]]);
    const joined = sparkGeometry({
      values: [1, 2, 3, 4, 5],
      missing: [false, false, true, false, false],
      width: 100,
      height: 30,
    });
    expect(joined.runs.map((r) => r.map((p) => p.i))).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it('将缺失点放在基线上并标记', () => {
    const g = sparkGeometry({ values, missing, width: 104, height: 28 });
    for (const p of g.points)
      if (missing[p.i]) {
        expect(p.missing).toBe(true);
        expect(p.y).toBe(g.baseline);
      } else expect(p.missing).toBe(false);
  });

  it('仅按已测量点缩放，缺失周的 0 不作为最小值', () => {
    const g = sparkGeometry({ values, missing, width: 104, height: 28 });
    const byI = new Map(g.points.map((p) => [p.i, p]));
    // 10 is the lowest measured value, 40 the highest: they take the bottom and the top of the plot.
    expect(byI.get(7)!.y).toBe(g.baseline);
    expect(byI.get(2)!.y).toBe(SPARK_PAD);
    expect(byI.get(4)!.y).toBeGreaterThan(SPARK_PAD);
    expect(byI.get(4)!.y).toBeLessThan(g.baseline);
  });

  it('无论缺失情况如何都均匀分布点位', () => {
    const g = sparkGeometry({ values, missing, width: 104, height: 28 });
    expect(g.points.map((p) => p.x)).toEqual(
      original(values, 104, 28).map((p) => p.x)
    );
  });

  it('完全没有测量值时无线段，且避免除以零', () => {
    const g = sparkGeometry({
      values: [0, 0, 0],
      missing: [true, true, true],
      width: 100,
      height: 30,
    });
    expect(g.runs).toEqual([]);
    expect(g.points.every((p) => Number.isFinite(p.y) && p.missing)).toBe(true);
  });

  it('识别最后一个点即本周是否缺失', () => {
    const g = sparkGeometry({
      values: [5, 6, 0],
      missing: [false, false, true],
      width: 100,
      height: 30,
    });
    expect(g.points[g.last].missing).toBe(true);
    expect(g.runs.map((r) => r.map((p) => p.i))).toEqual([[0, 1]]);
  });
});
