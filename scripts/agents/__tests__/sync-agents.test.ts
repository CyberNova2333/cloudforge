// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('共享项目规则入口与 .agents/skills/ 的同步', () => {
  it('仓库中的 Claude 入口与技能副本保持同步', () => {
    // Stale? Run `yarn agents:sync` and commit what it writes.
    expect(staleFiles(ROOT)).toEqual([]);
  });

  it('Claude 入口导入规范源，生成器不拥有 AGENTS.md', () => {
    const files = expectedFiles(ROOT);
    expect(files.has('AGENTS.md')).toBe(false);
    const claude = files.get('CLAUDE.md')!.toString('utf8');
    expect(claude).toContain('\n@AGENTS.md\n');
    expect(claude).toContain('[AGENTS.md](AGENTS.md)');
    expect(claude).not.toContain('常用命令');
  });

  it('补齐缺失、更新过时、删除来源已不存在的副本，之后不再过时', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-sync-'));
    try {
      const policy = '# AGENTS.md\n\nrules owned by the maintainer\n';
      writeFileSync(join(dir, 'AGENTS.md'), policy);
      mkdirSync(join(dir, '.claude', 'skills', 'a'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'skills', 'a', 'SKILL.md'), 'a\n');
      mkdirSync(join(dir, '.agents', 'skills', 'gone'), { recursive: true });
      writeFileSync(join(dir, '.agents', 'skills', 'gone', 'SKILL.md'), 'x\n');
      expect(staleFiles(dir)).toEqual([
        '.agents/skills/a/SKILL.md',
        '.agents/skills/gone/SKILL.md',
        'CLAUDE.md',
      ]);
      sync(dir);
      expect(staleFiles(dir)).toEqual([]);
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(policy);
      expect(
        readFileSync(join(dir, '.agents', 'skills', 'a', 'SKILL.md'), 'utf8')
      ).toBe('a\n');
      // A checkout that turned LF into CRLF is still up to date.
      const agents = join(dir, 'CLAUDE.md');
      writeFileSync(
        agents,
        readFileSync(agents, 'utf8').replace(/\n/g, '\r\n')
      );
      expect(staleFiles(dir)).toEqual([]);
      writeFileSync(join(dir, 'CLAUDE.md'), '# obsolete duplicate rules\n');
      expect(staleFiles(dir)).toEqual(['CLAUDE.md']);
      sync(dir);
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(policy);
      writeFileSync(join(dir, 'AGENTS.md'), policy + '\nnew rules\n');
      expect(staleFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
