// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { structuredPatch } from 'diff';
import { encoder, exactUtf8, sha1, toBinaryString, toHex } from './bytes';
import { MAX_EDIT_LENGTH, type FileChange, type GitService } from './service';

/** Above this (both sides together) a file's change counts by its blob ids, not its lines. */
const MAX_PATCH_BYTES = 1024 * 1024;

/** A changed line as identity sees it: indentation kept, inner whitespace runs as one space, no trailing whitespace. */
function normalise(line: string): string {
  const kept = line.trimEnd(); // a whitespace-only line counts as empty
  const indent = /^\s*/.exec(kept)![0];
  return indent + kept.slice(indent.length).replace(/\s+/g, ' ');
}

const isBinary = (b: Uint8Array) => b.subarray(0, 8000).includes(0);

/**
 * The patch identity of a change: a hash of each file's path, status and mode and of its added and removed lines
 * (indentation kept, inner whitespace collapsed, trailing whitespace dropped, so a re-indent is its own change). Line
 * numbers and context lines are left out, so the same change made at another place in a file, or next to different
 * lines, has the same identity. Binary, submodule and huge changes count by
 * their blob ids.
 */
export async function changesPatchId(
  git: GitService,
  changes: FileChange[],
  strict = false
): Promise<string> {
  const parts: string[] = [];
  for (const ch of [...changes].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )) {
    parts.push(`${ch.status} ${ch.mode} ${ch.path}`);
    if (ch.mode === '160000') {
      parts.push(`${ch.oldHash} ${ch.newHash}`);
      continue;
    }
    const [a, b] = await Promise.all([
      ch.oldHash ? git.blob(ch.oldHash, strict) : null,
      ch.newHash ? git.blob(ch.newHash, strict) : null,
    ]);
    const size = (a?.length ?? 0) + (b?.length ?? 0);
    if (size > MAX_PATCH_BYTES || (a && isBinary(a)) || (b && isBinary(b))) {
      parts.push(`${ch.oldHash} ${ch.newHash}`);
      continue;
    }
    // Exact UTF-8 (a BOM counts), else the bytes themselves: two changes that differ in any byte never share an identity.
    const [ta, tb] = [a, b].map((x) => (x ? exactUtf8(x) : ''));
    const isUtf8 = ta !== null && tb !== null;
    const patch = structuredPatch(
      ch.path,
      ch.path,
      isUtf8 ? ta! : a ? toBinaryString(a) : '',
      isUtf8 ? tb! : b ? toBinaryString(b) : '',
      '',
      '',
      { context: 0, maxEditLength: a && b ? MAX_EDIT_LENGTH : Infinity }
    );
    // Too many changed lines to work out: the change is named by its blobs, as a large file is.
    if (!patch) {
      parts.push(`${ch.oldHash} ${ch.newHash}`);
      continue;
    }
    for (const h of patch.hunks)
      for (const l of h.lines)
        if (l[0] === '+' || l[0] === '-')
          // Whitespace is only normalised in real text: in a byte string, 0x85 and 0xA0 are parts of characters.
          parts.push(l[0] + (isUtf8 ? normalise(l.slice(1)) : l.slice(1)));
  }
  return toHex(await sha1(encoder.encode(parts.join('\n'))));
}

/** The patch identity of the change from tree `a` to tree `b` (null: empty). */
export async function patchId(
  git: GitService,
  a: string | null,
  b: string | null
): Promise<string> {
  return changesPatchId(git, await git.diffTrees(a, b));
}
