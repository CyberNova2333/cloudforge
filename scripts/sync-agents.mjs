// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// AGENTS.md is the canonical project policy, shared by all coding agents:
//   CLAUDE.md        = a short entry point importing AGENTS.md
//   .agents/skills/  = a byte-for-byte copy of .claude/skills/
//   node scripts/sync-agents.mjs           writes them (yarn agents:sync)
//   node scripts/sync-agents.mjs --check   lists what is stale and exits 1 (scripts/__tests__/sync-agents.test.ts)
// Edit AGENTS.md or .claude/skills/, never the generated files.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLAUDE_ENTRY = `<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Claude 入口

@AGENTS.md

所有项目规则以 [AGENTS.md](AGENTS.md) 为单一来源。本入口由 \`yarn agents:sync\` 生成；修改规则请编辑 AGENTS.md。
仓库问题和行为变更按 AGENTS.md 的 repo-docs 同步约定处理。
`;

const SKILLS_FROM = '.claude/skills';
const SKILLS_TO = '.agents/skills';

const lf = (text) => text.replace(/\r\n/g, '\n');

/** Every file under `dir`, as paths relative to it with forward slashes. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** What the generated files should contain: repository-relative path → content. */
export function expectedFiles(root) {
  // Refuse a missing policy rather than silently manufacturing one from an old entry point.
  readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const files = new Map();
  files.set('CLAUDE.md', Buffer.from(CLAUDE_ENTRY));
  for (const f of filesUnder(join(root, SKILLS_FROM)))
    files.set(`${SKILLS_TO}/${f}`, readFileSync(join(root, SKILLS_FROM, f)));
  return files;
}

/**
 * Generated files that are missing, differ, or no longer have a source (sorted). Compared with line endings made
 * LF, so a checkout that converts them (core.autocrlf) is not stale.
 */
export function staleFiles(root) {
  const want = expectedFiles(root);
  const stale = [];
  for (const [path, content] of want) {
    const p = join(root, path);
    if (
      !existsSync(p) ||
      lf(readFileSync(p, 'utf8')) !== lf(content.toString('utf8'))
    )
      stale.push(path);
  }
  for (const f of filesUnder(join(root, SKILLS_TO)))
    if (!want.has(`${SKILLS_TO}/${f}`)) stale.push(`${SKILLS_TO}/${f}`);
  return stale.sort();
}

/** Writes the generated files and removes skill copies whose source is gone. Returns what changed. */
export function sync(root) {
  const stale = staleFiles(root);
  const want = expectedFiles(root);
  for (const path of stale) {
    const p = join(root, path);
    const content = want.get(path);
    if (content === undefined) rmSync(p);
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
  }
  return stale;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isMain =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes('--check')) {
    const stale = staleFiles(ROOT);
    if (stale.length) {
      console.error(
        `Stale, run \`yarn agents:sync\`:\n${stale.map((s) => `  ${s}`).join('\n')}`
      );
      process.exit(1);
    }
  } else {
    const changed = sync(ROOT);
    console.log(
      changed.length
        ? `Updated:\n${changed.map((s) => `  ${s}`).join('\n')}`
        : 'CLAUDE.md and .agents/skills/ are up to date; AGENTS.md remains the policy source.'
    );
  }
}
