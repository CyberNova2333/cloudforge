// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { fnv1a, identiconCells } from './identicon';

describe('fnv1a：哈希函数', () => {
  it('生成 32 位 FNV-1a 哈希', () => {
    // Published FNV-1a test vectors.
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
});

describe('identiconCells：默认头像单元格', () => {
  it('生成 5×5 网格', () => {
    expect(identiconCells('octocat').cells).toHaveLength(25);
  });

  it('结果具有确定性', () => {
    expect(identiconCells('mahmoud')).toEqual(identiconCells('mahmoud'));
  });

  it('与用户名一样忽略大小写', () => {
    expect(identiconCells('Mahmoud')).toEqual(identiconCells('mahmoud'));
  });

  it('镜像第 0↔4 列和第 1↔3 列', () => {
    for (const seed of ['mahmoud', 'cho', 'octocat', 'a', 'securityagent']) {
      const { cells } = identiconCells(seed);
      for (let y = 0; y < 5; y++) {
        expect(cells[y * 5 + 0]).toBe(cells[y * 5 + 4]);
        expect(cells[y * 5 + 1]).toBe(cells[y * 5 + 3]);
      }
    }
  });

  it('从哈希位读取左半边的 15 个单元格', () => {
    const h = fnv1a('mahmoud');
    const { cells } = identiconCells('mahmoud');
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++)
        expect(cells[y * 5 + x]).toBe(((h >>> (y * 3 + x)) & 1) === 1);
  });

  it('以 hash % 360 为色相、55% 为饱和度、52% 为亮度着色', () => {
    const h = fnv1a('mahmoud');
    expect(identiconCells('mahmoud').color).toBe(`hsl(${h % 360} 55% 52%)`);
  });

  it('为不同用户生成不同图形', () => {
    const a = identiconCells('mahmoud');
    const b = identiconCells('cho');
    expect(a.cells.join() === b.cells.join() && a.color === b.color).toBe(
      false
    );
  });
});
