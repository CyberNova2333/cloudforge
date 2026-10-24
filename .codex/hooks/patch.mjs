// Codex sends apply_patch text in tool_input.command, not Claude's file_path.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function inside(root, file) {
  const rel = relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// Resolve existing ancestors too: a new file can live below a directory symlink.
function canonical(file) {
  if (existsSync(file)) return realpathSync(file);
  const parent = dirname(file);
  return parent === file
    ? file
    : resolve(canonical(parent), relative(parent, file));
}

/** Repository-relative paths touched by a patch, including both sides of a move.
 * Paths are relative to the event cwd. Patch body lines carry a prefix, so source
 * text containing a fake header cannot add a file to this list. */
export function patchFiles(input, root) {
  if (input?.tool_name !== 'apply_patch') return [];
  const patch = input?.tool_input?.command;
  if (typeof patch !== 'string')
    throw new Error('apply_patch 缺少字符串 command。');
  const lines = patch.trim().split(/\r?\n/);
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch')
    throw new Error('无法识别 apply_patch 的补丁边界。');
  const files = new Set();
  const realRoot = realpathSync(root);
  for (const line of lines) {
    const match =
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    if (!match) continue;
    const file = resolve(input.cwd || root, match[1]);
    const realFile = canonical(file);
    // Hooks belong to this repository; don't format files in another workspace.
    if (!inside(realRoot, realFile)) continue;
    for (const [base, candidate] of [
      [root, file],
      [realRoot, realFile],
    ]) {
      if (inside(base, candidate))
        files.add(relative(base, candidate).split(sep).join('/'));
    }
  }
  return [...files];
}
