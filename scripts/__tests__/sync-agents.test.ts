import { describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedFiles, staleFiles, sync } from '../sync-agents.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('AGENTS.md 与 .agents/skills/ 的同步', () => {
  it('仓库中的生成文件与 CLAUDE.md、.claude/skills/ 一致', () => {
    // Stale? Run `yarn agents:sync` and commit what it writes.
    expect(staleFiles(ROOT)).toEqual([]);
  });

  it('AGENTS.md 是开头说明加上 CLAUDE.md 原文，不替换任何用词', () => {
    const agents = expectedFiles(ROOT).get('AGENTS.md')!.toString('utf8');
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8').replace(
      /\r\n/g,
      '\n'
    );
    expect(agents.startsWith('# AGENTS.md\n')).toBe(true);
    expect(agents.endsWith(claude)).toBe(true);
    expect(agents).toContain('Let Claude decide');
  });

  it('补齐缺失、更新过时、删除来源已不存在的副本，之后不再过时', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-sync-'));
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\nrules\n');
      mkdirSync(join(dir, '.claude', 'skills', 'a'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'skills', 'a', 'SKILL.md'), 'a\n');
      mkdirSync(join(dir, '.agents', 'skills', 'gone'), { recursive: true });
      writeFileSync(join(dir, '.agents', 'skills', 'gone', 'SKILL.md'), 'x\n');
      expect(staleFiles(dir)).toEqual([
        '.agents/skills/a/SKILL.md',
        '.agents/skills/gone/SKILL.md',
        'AGENTS.md',
      ]);
      sync(dir);
      expect(staleFiles(dir)).toEqual([]);
      expect(
        readFileSync(join(dir, '.agents', 'skills', 'a', 'SKILL.md'), 'utf8')
      ).toBe('a\n');
      // A checkout that turned LF into CRLF is still up to date.
      const agents = join(dir, 'AGENTS.md');
      writeFileSync(
        agents,
        readFileSync(agents, 'utf8').replace(/\n/g, '\r\n')
      );
      expect(staleFiles(dir)).toEqual([]);
      writeFileSync(join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\nnew rules\n');
      expect(staleFiles(dir)).toEqual(['AGENTS.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
