// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { changesPatchId } from '../git/patch-id';
import type { Commit, GitService } from '../git/service';

/**
 * A branch's own commits over a target, parents first. Each has a rebase identity: author email, author time and
 * message, which `git rebase` (and CloudForge's rebase runs) keep. Two branches holding the same commits, or rebased
 * copies of them, share identities; a match between different SHAs counts only when the two commits' patch ids agree
 * too (`git/patch-id.ts`). That is how stacking tells a child from its parent without asking a model.
 */
export type Lineage = {
  shas: string[];
  ids: string[];
  /** The range was longer than MAX_LINEAGE: containment can't be told. */
  truncated: boolean;
};

/** Beyond this many commits a branch's lineage is not compared (no git verdict, no trimming). */
export const MAX_LINEAGE = 300;

async function identity(c: Commit): Promise<string> {
  const text = `${c.author.email.toLowerCase()}\n${c.authoredAt}\n${c.message.trim()}`;
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest).slice(0, 10)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The commits `head` has over `base`, as a lineage. */
export async function lineageOf(
  git: GitService,
  base: string,
  head: string,
  strict = false
): Promise<Lineage> {
  if (base === head) return { shas: [], ids: [], truncated: false };
  if (strict && (!(await git.commit(base)) || !(await git.commit(head))))
    throw new Error('Could not read lineage endpoints');
  const commits = await git.commitsBetween(base, head);
  if (strict && commits.length <= MAX_LINEAGE) {
    const have = new Set(commits.map((c) => c.hash));
    // commitsBetween is a bounded, permissive history reader. Verify every boundary of the supposedly complete
    // range: an omitted parent must be proven in the base, never merely missing from an Artifacts response.
    if (!have.has(head) && (await git.isAncestor(head, base, true)) !== true)
      throw new Error('Incomplete lineage head');
    for (const c of commits)
      for (const parent of c.parents)
        if (
          !have.has(parent) &&
          (await git.isAncestor(parent, base, true)) !== true
        )
          throw new Error('Incomplete lineage parent');
  }
  const kept = commits.slice(-MAX_LINEAGE);
  return {
    shas: kept.map((c) => c.hash),
    ids: await Promise.all(kept.map(identity)),
    truncated: commits.length > MAX_LINEAGE,
  };
}

// A commit's patch id never changes: remembered per isolate (capped), like `contains`.
const patchMemo = new Map<string, Promise<string | null>>();
const MAX_MEMO = 2000;

/** The patch id of what commit `sha` changed over its first parent; null when git can't say. */
function patchIdOf(
  git: GitService,
  sha: string,
  strict = false
): Promise<string | null> {
  const key = `${strict ? 'strict:' : ''}${sha}`;
  const hit = patchMemo.get(key);
  if (hit) return hit;
  const p = (async () => {
    const c = await git.commit(sha);
    if (!c) return null;
    const parent = c.parents[0] ? await git.commit(c.parents[0]) : null;
    if (c.parents[0] && !parent) return null;
    const changes = await git.diffTrees(
      parent?.treeHash ?? null,
      c.treeHash,
      '',
      strict
    );
    return changesPatchId(git, changes, strict);
  })().then(
    (id) => {
      if (id === null) patchMemo.delete(key);
      return id;
    },
    () => {
      patchMemo.delete(key);
      return null;
    }
  );
  if (patchMemo.size >= MAX_MEMO)
    patchMemo.delete(patchMemo.keys().next().value!);
  patchMemo.set(key, p);
  return p;
}

/**
 * The identities of `x`'s commits that `y` also holds: the same commit, or a copy with the same rebase identity and
 * patch id.
 */
export async function sharedWith(
  git: GitService,
  x: Lineage,
  y: Lineage,
  /** Landing must reject unreadable patch evidence instead of treating it as disjoint. */
  strict = false
): Promise<Set<string>> {
  const theirs = new Map<string, string[]>();
  y.ids.forEach((id, i) =>
    theirs.set(id, [...(theirs.get(id) ?? []), y.shas[i]])
  );
  const out = new Set<string>();
  for (let i = 0; i < x.ids.length; i++) {
    const id = x.ids[i];
    const shas = theirs.get(id);
    if (!shas || out.has(id)) continue;
    if (shas.includes(x.shas[i])) {
      out.add(id);
      continue;
    }
    const mine = await patchIdOf(git, x.shas[i], strict);
    if (!mine && strict)
      throw new Error('Could not read commit patch identity');
    if (!mine) continue;
    for (const s of shas) {
      const theirs = await patchIdOf(git, s, strict);
      if (!theirs && strict)
        throw new Error('Could not read commit patch identity');
      if (theirs === mine) {
        out.add(id);
        break;
      }
    }
  }
  return out;
}

/** `outer` holds every commit of `inner` (or a rebased copy of it), and more. */
export async function holdsWhole(
  git: GitService,
  outer: Lineage,
  inner: Lineage
): Promise<boolean> {
  if (outer.truncated || inner.truncated || !inner.ids.length) return false;
  // Cheap first: every identity must be there before any patch id is read.
  const have = new Set(outer.ids);
  if (!inner.ids.every((i) => have.has(i))) return false;
  const want = new Set(inner.ids);
  if (have.size <= want.size) return false;
  return (await sharedWith(git, inner, outer)).size === want.size;
}

/**
 * All whole-lineage containment for a discovery snapshot. An inverted identity index excludes disjoint pairs
 * before the expensive comparison. Actual candidates still use holdsWhole (including patch-id verification).
 */
export async function lineageOwnership(
  git: GitService,
  lineages: Iterable<Lineage>
): Promise<Map<Lineage, Set<Lineage>>> {
  const all = [...lineages];
  const holders = new Map(all.map((l) => [l, new Set<Lineage>()]));
  const byIdentity = new Map<string, Set<Lineage>>();
  for (const outer of all) {
    if (outer.truncated) continue;
    for (const id of new Set(outer.ids)) {
      if (!byIdentity.has(id)) byIdentity.set(id, new Set());
      byIdentity.get(id)!.add(outer);
    }
  }
  for (const inner of all) {
    if (inner.truncated || !inner.ids.length) continue;
    // Every containing lineage must hold even the rarest identity. This changes only the search, never verdicts.
    const candidates = inner.ids.reduce<Set<Lineage> | undefined>(
      (smallest, id) => {
        const found = byIdentity.get(id)!;
        return !smallest || found.size < smallest.size ? found : smallest;
      },
      undefined
    )!;
    for (const outer of candidates)
      if (outer !== inner && (await holdsWhole(git, outer, inner)))
        holders.get(outer)!.add(inner);
  }
  return holders;
}

/**
 * The commit `x`'s own changes start from: the last of its leading commits that belong to `owned` (the commits of
 * open pull requests it holds whole). Null when none lead (its changes start at the target).
 */
export function ownBase(x: Lineage, owned: Set<string>): string | null {
  let k = 0;
  while (k < x.ids.length && owned.has(x.ids[k])) k++;
  // All of them: nothing of its own; compare it whole rather than as an empty change.
  if (k === 0 || k === x.ids.length) return null;
  return x.shas[k - 1];
}
