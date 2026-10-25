// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { structuredPatch } from 'diff';
import { mergeDiff3 } from 'node-diff3';
import { decoder, exactUtf8, fromBinaryString, toBinaryString } from './bytes';
import {
  makeBlob,
  makeCommit,
  makeTree,
  parseTree,
  type GitObject,
  type Signature,
  type TreeEntry,
} from './objects';
import { ArtifactsRepoClient, ZERO_SHA } from './remote';

export type Commit = ArtifactsCommitMetadata;
export type Entry = ArtifactsTreeEntry;

const SHA_RE = /^[0-9a-f]{40}$/;
/** Commits one history walk visits before it gives up (cached commits cost no read). */
const MAX_WALK = 10_000;
/** Artifacts reads one walk makes past the first-parent chains it starts from, a log page each. */
const MAX_WALK_READS = 200;
/** First-parent commits read with each end of a walk, and with each later read. */
const SEED_PAGE = 1000;
const WALK_PAGE = 100;
/** Commits `commitsBetween` walks after only uninteresting ones are queued (git's SLOP). */
const WALK_SLOP = 5;

type WalkBudget = { reads: number; truncated: boolean };

/** Commits by committer time, newest first (ties by hash, so walks are deterministic): a binary heap. */
class DateQueue {
  private heap: Commit[] = [];
  get size() {
    return this.heap.length;
  }
  private before(x: Commit, y: Commit) {
    return (
      x.committedAt > y.committedAt ||
      (x.committedAt === y.committedAt && x.hash < y.hash)
    );
  }
  push(c: Commit) {
    const h = this.heap;
    h.push(c);
    for (let i = h.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (!this.before(h[i], h[parent])) break;
      [h[i], h[parent]] = [h[parent], h[i]];
      i = parent;
    }
  }
  pop(): Commit | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length && last) {
      h[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.before(h[l], h[m])) m = l;
        if (r < h.length && this.before(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
  some(pred: (c: Commit) => boolean) {
    return this.heap.some(pred);
  }
}
const MAX_DIFF_FILES = 300;
const MAX_DIFF_BYTES = 512 * 1024;
/**
 * Most changed lines one file's diff may take to work out (jsdiff `maxEditLength`) when both sides have content: its
 * cost grows with the lines times this, and a file past it is shown as too large. Not a timeout: in a Worker the clock stands still while code runs.
 */
export const MAX_EDIT_LENGTH = 2000;

export class MergeConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`Merge conflict in ${paths.join(', ')}`);
  }
}

export interface FileChange {
  path: string;
  status: 'added' | 'removed' | 'modified';
  oldHash: string | null;
  newHash: string | null;
  mode: string;
}

export interface FileDiff extends FileChange {
  additions: number;
  deletions: number;
  binary: boolean;
  tooLarge: boolean;
  hunks: {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }[];
}

const isTree = (e: { mode: string }) =>
  e.mode === '40000' || e.mode === '040000';
const isRegularFile = (mode: string) => mode === '100644' || mode === '100755';

/** Text merge limits; larger or binary files stay conflicts. */
const MAX_MERGE_BYTES = 1024 * 1024;
function isBinaryOrHuge(bytes: Uint8Array) {
  return bytes.length > MAX_MERGE_BYTES || bytes.subarray(0, 8000).includes(0);
}

/** Overlapping edits: the three versions and diff3 output with markers. */
export interface ConflictFile {
  path: string;
  base: string | null;
  ours: string;
  theirs: string;
  withMarkers: string;
}

interface MergeState {
  created: GitObject[];
  conflicts: string[];
  /** Collects details of text conflicts when set. */
  conflictFiles?: ConflictFile[];
  /** Final contents for conflicted paths; `null` resolves a path as deleted. */
  resolutions?: Map<string, string | null>;
  /** Conflict marker labels: ours, base, theirs. */
  labels?: { a: string; o: string; b: string };
}

/** Reads and writes for one repo via the Artifacts binding and smart HTTP. */
export class GitService {
  private commits = new Map<string, Commit>();
  private trees = new Map<string, Entry[]>();
  private refsCache?: Promise<Map<string, string>>;
  private headCache?: string | null;
  private peeledCache = new Map<string, string>();
  /** Objects made in memory (a rebase's trees, blobs and commits), readable before they are pushed. */
  private staged = new Map<string, GitObject>();

  constructor(readonly client: ArtifactsRepoClient) {}

  // ── refs ───────────────────────────────────────────────────────────────────

  refs(): Promise<Map<string, string>> {
    this.refsCache ??= this.client.listRefs().then((ad) => {
      this.headCache = ad.head;
      this.peeledCache = ad.peeled;
      return ad.refs;
    });
    return this.refsCache;
  }

  async branches(): Promise<{ name: string; sha: string }[]> {
    const refs = await this.refs();
    return [...refs]
      .filter(([name]) => name.startsWith('refs/heads/'))
      .map(([name, sha]) => ({ name: name.slice('refs/heads/'.length), sha }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every tag, by name descending; an annotated tag gives the commit it peels to. */
  async tags(): Promise<{ name: string; sha: string }[]> {
    const refs = await this.refs();
    return [...refs]
      .filter(([name]) => name.startsWith('refs/tags/'))
      .map(([name, sha]) => ({
        name: name.slice('refs/tags/'.length),
        sha: this.peeledCache.get(name) ?? sha,
      }))
      .sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { numeric: true })
      );
  }

  async resolve(ref: string): Promise<string | null> {
    if (SHA_RE.test(ref)) return ref;
    const refs = await this.refs();
    return (
      refs.get(`refs/heads/${ref}`) ??
      refs.get(`refs/tags/${ref}`) ??
      refs.get(ref) ??
      null
    );
  }

  // ── objects ────────────────────────────────────────────────────────────────

  /** Makes `objects` readable through tree() and blob() until this service is dropped (nothing is pushed). */
  stage(objects: GitObject[]) {
    for (const o of objects) this.staged.set(o.sha, o);
  }

  async commit(sha: string): Promise<Commit | null> {
    const hit = this.commits.get(sha);
    if (hit) return hit;
    const c = await (await this.client.repo()).readCommit(sha);
    if (c) this.commits.set(sha, c);
    return c;
  }

  async tree(sha: string): Promise<Entry[]> {
    const hit = this.trees.get(sha);
    if (hit) return hit;
    const staged = this.staged.get(sha);
    const t =
      staged?.type === 'tree'
        ? parseTree(staged.data)
        : ((await (await this.client.repo()).readTree(sha)) ?? []);
    this.trees.set(sha, t);
    return t;
  }

  async blob(sha: string): Promise<Uint8Array | null> {
    const staged = this.staged.get(sha);
    if (staged?.type === 'blob') return staged.data;
    const b = await this.readBlob(sha);
    return b ? new Uint8Array(await b.arrayBuffer()) : null;
  }

  /** Inspect size before buffering, or stream a blob without copying its entire contents. */
  async readBlob(sha: string): Promise<Blob | null> {
    const staged = this.staged.get(sha);
    if (staged?.type === 'blob') return new Blob([new Uint8Array(staged.data)]);
    return (await this.client.repo()).readBlob(sha);
  }

  async log(ref: string, limit = 30, offset = 0): Promise<Commit[]> {
    const list = await (await this.client.repo()).log({ ref, limit, offset });
    for (const c of list) this.commits.set(c.hash, c);
    return list;
  }

  /** Resolves `path` inside a commit to a tree listing or a blob entry. */
  async entryAt(
    commitSha: string,
    path: string
  ): Promise<
    | { type: 'tree'; hash: string; entries: Entry[] }
    | { type: 'blob'; entry: Entry }
    | null
  > {
    const commit = await this.commit(commitSha);
    if (!commit) return null;
    let treeHash = commit.treeHash;
    const parts = path.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const entry = (await this.tree(treeHash)).find(
        (e) => e.name === parts[i]
      );
      if (!entry) return null;
      if (isTree(entry)) {
        treeHash = entry.hash;
        continue;
      }
      return i === parts.length - 1 ? { type: 'blob', entry } : null;
    }
    return { type: 'tree', hash: treeHash, entries: await this.tree(treeHash) };
  }

  /** Last commit (first-parent, up to `depth`) that changed each entry of the tree at `path`. */
  async lastCommitsForTree(headSha: string, path: string, depth = 60) {
    const history = await this.log(headSha, depth);
    const result: Record<string, Commit> = {};
    const hashAt = async (c: Commit) => {
      const at = await this.entryAt(c.hash, path);
      return at?.type === 'tree'
        ? new Map(at.entries.map((e) => [e.name, e.hash]))
        : new Map();
    };
    let current = history.length
      ? await hashAt(history[0])
      : new Map<string, string>();
    const pending = new Set(current.keys());
    for (let i = 0; i < history.length && pending.size; i++) {
      const parent = history[i + 1];
      const prev = parent ? await hashAt(parent) : new Map<string, string>();
      for (const name of [...pending]) {
        if (prev.get(name) !== current.get(name)) {
          result[name] = history[i];
          pending.delete(name);
        }
      }
      current = prev;
    }
    return result;
  }

  // ── ancestry ───────────────────────────────────────────────────────────────

  // History walks follow every parent, newest commit first (by committer time), as git does: a merge commit's second
  // parent is history like its first. The first-parent chains of both ends are read up front, one log page each;
  // anything else is read a page at a time, within WalkBudget.

  /** `sha` for a walk: from the cache, else with its next first-parent commits in one read. Null past the budget. */
  private async walkCommit(
    sha: string,
    budget: WalkBudget
  ): Promise<Commit | null> {
    const hit = this.commits.get(sha);
    if (hit) return hit;
    if (budget.reads >= MAX_WALK_READS) {
      budget.truncated = true;
      return null;
    }
    budget.reads++;
    await this.log(sha, WALK_PAGE);
    return this.commits.get(sha) ?? (await this.commit(sha));
  }

  /** Reads the first-parent chains a walk starts from, and the walk's starting commits (null when one is missing). */
  private async walkStart(shas: string[], budget: WalkBudget) {
    await Promise.all(shas.map((sha) => this.log(sha, SEED_PAGE)));
    return Promise.all(shas.map((sha) => this.walkCommit(sha, budget)));
  }

  /**
   * The best common ancestors of `a` and `b`, newest first, and whether the walk finished (it gives up past
   * MAX_WALK commits or MAX_WALK_READS reads). git's paint_down_to_common: each commit is painted with the sides it is
   * reached from; one reached from both is a merge base, and its ancestors are stale (never a better base).
   */
  private async mergeBases(
    a: string,
    b: string
  ): Promise<{ bases: string[]; complete: boolean }> {
    const A = 1;
    const B = 2;
    const STALE = 4;
    const budget: WalkBudget = { reads: 0, truncated: false };
    const [ca, cb] = await this.walkStart([a, b], budget);
    if (!ca || !cb) return { bases: [], complete: !budget.truncated };
    const flags = new Map<string, number>([
      [a, A],
      [b, B],
    ]);
    const queue = new DateQueue();
    queue.push(ca);
    queue.push(cb);
    const bases: string[] = [];
    let visited = 0;
    while (queue.some((c) => !(flags.get(c.hash)! & STALE))) {
      if (++visited > MAX_WALK) return { bases, complete: false };
      const c = queue.pop()!;
      let f = flags.get(c.hash)! & (A | B | STALE);
      if ((f & (A | B)) === (A | B)) {
        if (!(f & STALE) && !bases.includes(c.hash)) bases.push(c.hash);
        f |= STALE;
      }
      for (const p of c.parents) {
        const pf = flags.get(p) ?? 0;
        if ((pf & f) === f) continue;
        const pc = await this.walkCommit(p, budget);
        if (!pc) continue;
        flags.set(p, pf | f);
        queue.push(pc);
      }
    }
    return { bases, complete: !budget.truncated };
  }

  /** Best common ancestor of `base` and `head`; null when they share no history (or it is too far to find). */
  async mergeBase(base: string, head: string): Promise<string | null> {
    if (base === head) return base;
    return (await this.mergeBases(base, head)).bases[0] ?? null;
  }

  /** Whether `ancestor` is in `descendant`'s history (itself included); null when the walk gave up first. */
  async isAncestor(
    ancestor: string,
    descendant: string
  ): Promise<boolean | null> {
    if (ancestor === descendant) return true;
    const { bases, complete } = await this.mergeBases(ancestor, descendant);
    if (bases.includes(ancestor)) return true;
    return complete ? false : null;
  }

  /**
   * Commits in `head`'s history but not in `base`'s (git's `base..head`), parents before children. Walks newest first,
   * marking `base`'s history uninteresting, and stops a few commits after only uninteresting ones are left (git's slop,
   * for clocks that disagree).
   */
  async commitsBetween(base: string, head: string): Promise<Commit[]> {
    if (base === head) return [];
    const OUT = 1;
    const SEEN = 2;
    const budget: WalkBudget = { reads: 0, truncated: false };
    const [cb, ch] = await this.walkStart([base, head], budget);
    if (!ch) return [];
    const flags = new Map<string, number>();
    const queue = new DateQueue();
    if (cb) {
      flags.set(base, OUT | SEEN);
      queue.push(cb);
    }
    flags.set(head, (flags.get(head) ?? 0) | SEEN);
    queue.push(ch);
    const done = new Set<string>();
    /** Marks `sha` and what it reaches as uninteresting, including commits already walked as interesting. */
    const markOut = async (sha: string) => {
      const stack = [sha];
      while (stack.length) {
        const s = stack.pop()!;
        const f = flags.get(s) ?? 0;
        if (f & OUT) continue;
        flags.set(s, f | OUT | SEEN);
        if (done.has(s)) stack.push(...(this.commits.get(s)?.parents ?? []));
        else if (!(f & SEEN)) {
          const c = await this.walkCommit(s, budget);
          if (c) queue.push(c);
        }
      }
    };
    let slop = WALK_SLOP;
    let visited = 0;
    while (queue.size && ++visited <= MAX_WALK) {
      if (queue.some((c) => !(flags.get(c.hash)! & OUT))) slop = WALK_SLOP;
      else if (--slop < 0) break;
      const c = queue.pop()!;
      if (done.has(c.hash)) continue;
      done.add(c.hash);
      const out = flags.get(c.hash)! & OUT;
      for (const p of c.parents) {
        if (out) {
          await markOut(p);
          continue;
        }
        const pf = flags.get(p) ?? 0;
        if (pf & SEEN) continue;
        const pc = await this.walkCommit(p, budget);
        if (!pc) continue;
        flags.set(p, pf | SEEN);
        queue.push(pc);
      }
    }
    const keep = new Set([...done].filter((sha) => !(flags.get(sha)! & OUT)));
    // Parents before children: a depth-first walk from the head, each commit after its parents (first parent first).
    const order: Commit[] = [];
    const placed = new Set<string>([head]);
    const stack: [string, number][] = [[head, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const c = this.commits.get(top[0])!;
      const next = c.parents[top[1]++];
      if (next !== undefined) {
        if (keep.has(next) && !placed.has(next)) {
          placed.add(next);
          stack.push([next, 0]);
        }
        continue;
      }
      stack.pop();
      order.push(c);
    }
    return keep.has(head) ? order : [];
  }

  // ── diffs ──────────────────────────────────────────────────────────────────

  async diffTrees(
    a: string | null,
    b: string | null,
    prefix = ''
  ): Promise<FileChange[]> {
    if (a === b) return [];
    const left = a ? await this.tree(a) : [];
    const right = b ? await this.tree(b) : [];
    const lmap = new Map(left.map((e) => [e.name, e]));
    const rmap = new Map(right.map((e) => [e.name, e]));
    const names = [...new Set([...lmap.keys(), ...rmap.keys()])].sort();
    const out: FileChange[] = [];
    for (const name of names) {
      const l = lmap.get(name);
      const r = rmap.get(name);
      const path = prefix + name;
      if (l && r && l.hash === r.hash && l.mode === r.mode) continue;
      const lt = l && isTree(l);
      const rt = r && isTree(r);
      if (lt || rt) {
        out.push(
          ...(await this.diffTrees(
            lt ? l!.hash : null,
            rt ? r!.hash : null,
            path + '/'
          ))
        );
      }
      const lf = l && !lt ? l : null;
      const rf = r && !rt ? r : null;
      if (lf && rf) {
        out.push({
          path,
          status: 'modified',
          oldHash: lf.hash,
          newHash: rf.hash,
          mode: rf.mode,
        });
      } else if (lf) {
        out.push({
          path,
          status: 'removed',
          oldHash: lf.hash,
          newHash: null,
          mode: lf.mode,
        });
      } else if (rf) {
        out.push({
          path,
          status: 'added',
          oldHash: null,
          newHash: rf.hash,
          mode: rf.mode,
        });
      }
    }
    return out;
  }

  async fileDiffs(changes: FileChange[]): Promise<FileDiff[]> {
    const out: FileDiff[] = [];
    for (const [i, ch] of changes.entries()) {
      const base: FileDiff = {
        ...ch,
        additions: 0,
        deletions: 0,
        binary: false,
        tooLarge: false,
        hunks: [],
      };
      if (i >= MAX_DIFF_FILES || ch.mode === '160000') {
        out.push({ ...base, tooLarge: true });
        continue;
      }
      const [oldBlob, newBlob] = await Promise.all([
        ch.oldHash ? this.readBlob(ch.oldHash) : null,
        ch.newHash ? this.readBlob(ch.newHash) : null,
      ]);
      const size = (oldBlob?.size ?? 0) + (newBlob?.size ?? 0);
      if (size > MAX_DIFF_BYTES) {
        out.push({ ...base, tooLarge: true });
        continue;
      }
      const [oldBytes, newBytes] = await Promise.all(
        [oldBlob, newBlob].map(async (blob) =>
          blob ? new Uint8Array(await blob.arrayBuffer()) : null
        )
      );
      if (isBinary(oldBytes) || isBinary(newBytes)) {
        out.push({ ...base, binary: true });
        continue;
      }
      const patch = structuredPatch(
        ch.path,
        ch.path,
        oldBytes ? decoder.decode(oldBytes) : '',
        newBytes ? decoder.decode(newBytes) : '',
        '',
        '',
        // A file added or deleted whole costs only its length to diff: no limit then.
        {
          context: 3,
          maxEditLength: oldBytes && newBytes ? MAX_EDIT_LENGTH : Infinity,
        }
      );
      if (!patch) {
        out.push({ ...base, tooLarge: true });
        continue;
      }
      for (const h of patch.hunks) {
        for (const l of h.lines) {
          if (l[0] === '+') base.additions++;
          else if (l[0] === '-') base.deletions++;
        }
      }
      out.push({ ...base, hunks: patch.hunks });
    }
    return out;
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Three-way tree merge; files changed on both sides merge by line (diff3). Overlaps, binaries,
   * delete/edit, and file/directory clashes conflict. `resolutions` sets conflicted paths' contents.
   */
  async mergeTrees(
    base: string | null,
    ours: string | null,
    theirs: string | null,
    state: MergeState,
    prefix = ''
  ): Promise<string | null> {
    if (ours === theirs) return ours;
    if (base === ours) return theirs;
    if (base === theirs) return ours;
    const [b, o, t] = await Promise.all([
      base ? this.tree(base) : [],
      ours ? this.tree(ours) : [],
      theirs ? this.tree(theirs) : [],
    ]);
    const bm = new Map(b.map((e) => [e.name, e]));
    const om = new Map(o.map((e) => [e.name, e]));
    const tm = new Map(t.map((e) => [e.name, e]));
    const result: TreeEntry[] = [];
    for (const name of new Set([...bm.keys(), ...om.keys(), ...tm.keys()])) {
      const be = bm.get(name);
      const oe = om.get(name);
      const te = tm.get(name);
      const path = prefix + name;
      const same = (x?: Entry, y?: Entry) =>
        (!x && !y) || (!!x && !!y && x.hash === y.hash && x.mode === y.mode);
      let pick: Entry | undefined;
      if (same(oe, te)) pick = oe;
      else if (same(be, oe)) pick = te;
      else if (same(be, te)) pick = oe;
      else if ((!oe || isTree(oe)) && (!te || isTree(te)) && (oe || te)) {
        const hash = await this.mergeTrees(
          be && isTree(be) ? be.hash : null,
          oe?.hash ?? null,
          te?.hash ?? null,
          state,
          path + '/'
        );
        if (hash) result.push({ name, mode: '40000', hash });
        continue;
      } else {
        const merged = await this.mergeFile(path, be, oe, te, state);
        if (merged) result.push({ name, mode: merged.mode, hash: merged.hash });
        continue;
      }
      if (pick)
        result.push({ name: pick.name, mode: pick.mode, hash: pick.hash });
    }
    if (!result.length) return null;
    const tree = await makeTree(result);
    state.created.push(tree);
    return tree.sha;
  }

  /** A file both sides changed: a supplied resolution, a clean line merge, or a conflict. */
  private async mergeFile(
    path: string,
    be: Entry | undefined,
    oe: Entry | undefined,
    te: Entry | undefined,
    state: MergeState
  ): Promise<{ mode: string; hash: string } | null> {
    const resolved = state.resolutions?.get(path);
    if (resolved !== undefined) {
      if (resolved === null) return null;
      const blob = await makeBlob(resolved);
      state.created.push(blob);
      return { mode: (oe ?? te)?.mode ?? '100644', hash: blob.sha };
    }
    const isFile = (e?: Entry) => !!e && isRegularFile(e.mode);
    // Both sides must be regular files; base is optional (add/add).
    if (!isFile(oe) || !isFile(te) || (be && !isFile(be))) {
      state.conflicts.push(path);
      return null;
    }
    const [bb, ob, tb] = await Promise.all([
      be ? this.blob(be.hash) : Promise.resolve(new Uint8Array()),
      this.blob(oe!.hash),
      this.blob(te!.hash),
    ]);
    if (!bb || !ob || !tb || [bb, ob, tb].some(isBinaryOrHuge)) {
      state.conflicts.push(path);
      return null;
    }
    // Merged line by line on the exact bytes: UTF-8 (BOM kept) as text, any other encoding one character per byte, so
    // a clean merge never rewrites a byte neither side changed.
    const utf8 = [bb, ob, tb].map(exactUtf8);
    const isUtf8 = utf8.every((t) => t !== null);
    const text = isUtf8 ? (utf8 as string[]) : [bb, ob, tb].map(toBinaryString);
    const merged = mergeDiff3(
      text[1].split('\n'),
      text[0].split('\n'),
      text[2].split('\n'),
      { label: state.labels ?? { a: 'ours', o: 'base', b: 'theirs' } }
    );
    // Take a one-sided mode change (e.g. +x).
    const mode = be && oe!.mode === be.mode ? te!.mode : oe!.mode;
    if (merged.conflict) {
      state.conflicts.push(path);
      // Only UTF-8 conflicts are shown and resolved as text (resolutions come back as UTF-8); another encoding stops
      // the rebase like a binary file does.
      if (isUtf8)
        state.conflictFiles?.push({
          path,
          base: be ? text[0] : null,
          ours: text[1],
          theirs: text[2],
          withMarkers: merged.result.join('\n'),
        });
      return null;
    }
    const result = merged.result.join('\n');
    const blob = await makeBlob(isUtf8 ? result : fromBinaryString(result));
    state.created.push(blob);
    return { mode, hash: blob.sha };
  }

  /** Merged tree of `head` into `base`; writes nothing. */
  async planMerge(
    baseSha: string,
    headSha: string,
    options: Pick<MergeState, 'resolutions' | 'labels'> & {
      collectConflictFiles?: boolean;
    } = {}
  ) {
    const mb = await this.mergeBase(baseSha, headSha);
    if (mb === headSha) return { upToDate: true as const };
    const [baseCommit, headCommit] = await Promise.all([
      this.commit(baseSha),
      this.commit(headSha),
    ]);
    if (!baseCommit || !headCommit) throw new Error('Missing commit');
    if (mb === baseSha) {
      return {
        upToDate: false as const,
        mergeBase: mb,
        tree: headCommit.treeHash,
        objects: [] as GitObject[],
        conflicts: [] as string[],
        conflictFiles: [] as ConflictFile[],
      };
    }
    const mbCommit = mb ? await this.commit(mb) : null;
    const state: MergeState = {
      created: [],
      conflicts: [],
      conflictFiles: options.collectConflictFiles ? [] : undefined,
      resolutions: options.resolutions,
      labels: options.labels,
    };
    const tree = await this.mergeTrees(
      mbCommit?.treeHash ?? null,
      baseCommit.treeHash,
      headCommit.treeHash,
      state
    );
    const emptyTree = tree ?? (await makeTree([])).sha;
    return {
      upToDate: false as const,
      mergeBase: mb,
      tree: emptyTree,
      objects: state.created,
      conflicts: state.conflicts,
      conflictFiles: state.conflictFiles ?? [],
    };
  }

  async merge(opts: {
    base: string;
    head: string;
    method: 'merge' | 'squash';
    message: string;
    author: Signature;
    committer?: Signature;
    extraRefs?: { ref: string; sha: string }[];
  }): Promise<{ sha: string; headSha: string }> {
    const baseSha = await this.resolve(opts.base);
    const headSha = await this.resolve(opts.head);
    if (!baseSha || !headSha) throw new Error('Branch not found');
    const plan = await this.planMerge(baseSha, headSha);
    if (plan.upToDate) throw new Error('Nothing to merge');
    if (plan.conflicts.length) throw new MergeConflictError(plan.conflicts);
    const commit = await makeCommit({
      tree: plan.tree,
      parents: opts.method === 'merge' ? [baseSha, headSha] : [baseSha],
      author: opts.author,
      committer: opts.committer,
      message: opts.message,
    });
    const refs = await this.refs();
    await this.client.push(
      [
        { ref: `refs/heads/${opts.base}`, old: baseSha, new: commit.sha },
        ...(opts.extraRefs ?? []).map((r) => ({
          ref: r.ref,
          old: refs.get(r.ref) ?? ZERO_SHA,
          new: r.sha,
        })),
      ],
      [...plan.objects, commit]
    );
    return { sha: commit.sha, headSha };
  }

  async setRef(ref: string, sha: string) {
    const refs = await this.refs();
    if (refs.get(ref) === sha) return;
    await this.client.push(
      [{ ref, old: refs.get(ref) ?? ZERO_SHA, new: sha }],
      []
    );
  }

  /**
   * Creates `ref` at `sha` only while it does not exist (compare-and-swap from absent): an existing ref is never moved,
   * and the push throws GitPushError. The refs are read again afterwards either way.
   */
  async createRef(ref: string, sha: string) {
    try {
      await this.client.push([{ ref, old: ZERO_SHA, new: sha }], []);
    } finally {
      this.refsCache = undefined;
    }
  }

  /** Deletes `ref` only while it still points at `expected` (compare-and-swap); otherwise the push throws GitPushError. */
  async deleteRef(ref: string, expected: string) {
    try {
      await this.client.push([{ ref, old: expected, new: ZERO_SHA }], []);
    } finally {
      this.refsCache = undefined;
    }
  }

  /**
   * Deletes a branch. With `expected`, only while it still points there (compare-and-swap):
   * a concurrent push wins and the push throws GitPushError.
   */
  async deleteBranch(name: string, expected?: string) {
    const sha = expected ?? (await this.resolve(name));
    if (!sha) return;
    await this.client.push(
      [{ ref: `refs/heads/${name}`, old: sha, new: ZERO_SHA }],
      []
    );
  }

  /** First commit on an empty repo ("Add a README file", a new agent). Paths may contain directories. */
  async initialCommit(
    branch: string,
    files: Record<string, string | Uint8Array>,
    author: Signature,
    message: string
  ) {
    const objects: GitObject[] = [];
    const tree = await writeTree(files, objects);
    const commit = await makeCommit({ tree, parents: [], author, message });
    await this.client.push(
      [{ ref: `refs/heads/${branch}`, old: ZERO_SHA, new: commit.sha }],
      [...objects, commit]
    );
    return commit.sha;
  }

  /**
   * Commits `files` (repository paths; null deletes) on top of `parent`, and moves `branch` there with
   * compare-and-swap: throws GitPushError when the branch is no longer at `parent`. Returns the new commit.
   */
  async commitFiles(opts: {
    branch: string;
    parent: string;
    files: Record<string, string | null>;
    author: Signature;
    committer?: Signature;
    message: string;
  }): Promise<string> {
    const parent = await this.commit(opts.parent);
    if (!parent) throw new Error('Missing commit');
    const objects: GitObject[] = [];
    let tree = await this.applyFiles(parent.treeHash, opts.files, objects);
    if (!tree) {
      const empty = await makeTree([]);
      objects.push(empty);
      tree = empty.sha;
    }
    const commit = await makeCommit({
      tree,
      parents: [opts.parent],
      author: opts.author,
      committer: opts.committer,
      message: opts.message,
    });
    await this.client.push(
      [
        {
          ref: `refs/heads/${opts.branch}`,
          old: opts.parent,
          new: commit.sha,
        },
      ],
      [...objects, commit]
    );
    return commit.sha;
  }

  /** `treeSha` with `files` (paths relative to it) written or removed, new objects in `out`; null when empty. */
  private async applyFiles(
    treeSha: string | null,
    files: Record<string, string | null>,
    out: GitObject[]
  ): Promise<string | null> {
    const entries = new Map<string, TreeEntry>(
      (treeSha ? await this.tree(treeSha) : []).map((e) => [
        e.name,
        { name: e.name, mode: e.mode, hash: e.hash },
      ])
    );
    const dirs = new Map<string, Record<string, string | null>>();
    for (const [path, content] of Object.entries(files)) {
      const slash = path.indexOf('/');
      if (slash >= 0) {
        const name = path.slice(0, slash);
        const sub = dirs.get(name) ?? {};
        sub[path.slice(slash + 1)] = content;
        dirs.set(name, sub);
        continue;
      }
      const old = entries.get(path);
      // Never a silent swap of a directory for a file (or back): that would drop everything under it.
      if (old && isTree(old))
        throw new Error(`${path} is a directory, not a file`);
      if (Object.keys(files).some((p) => p.startsWith(`${path}/`)))
        throw new Error(`${path} is written both as a file and a directory`);
      if (content === null) {
        entries.delete(path);
        continue;
      }
      const blob = await makeBlob(content);
      out.push(blob);
      entries.set(path, {
        name: path,
        mode: old && isRegularFile(old.mode) ? old.mode : '100644',
        hash: blob.sha,
      });
    }
    for (const [name, sub] of dirs) {
      const old = entries.get(name);
      if (old && !isTree(old))
        throw new Error(`${name} is a file, not a directory`);
      const hash = await this.applyFiles(old ? old.hash : null, sub, out);
      if (hash) entries.set(name, { name, mode: '40000', hash });
      else entries.delete(name);
    }
    if (!entries.size) return null;
    const tree = await makeTree([...entries.values()]);
    out.push(tree);
    return tree.sha;
  }
}

/** Builds the tree for `files` (paths may contain directories), collecting every new object in `out`. */
async function writeTree(
  files: Record<string, string | Uint8Array>,
  out: GitObject[]
): Promise<string> {
  const entries: TreeEntry[] = [];
  const dirs = new Map<string, Record<string, string | Uint8Array>>();
  for (const [path, content] of Object.entries(files)) {
    const slash = path.indexOf('/');
    if (slash < 0) {
      const blob = await makeBlob(content);
      out.push(blob);
      entries.push({ name: path, mode: '100644', hash: blob.sha });
      continue;
    }
    const dir = path.slice(0, slash);
    const sub = dirs.get(dir) ?? {};
    sub[path.slice(slash + 1)] = content;
    dirs.set(dir, sub);
  }
  for (const [name, sub] of dirs)
    entries.push({ name, mode: '40000', hash: await writeTree(sub, out) });
  const tree = await makeTree(entries);
  out.push(tree);
  return tree.sha;
}

function isBinary(bytes: Uint8Array | null): boolean {
  if (!bytes) return false;
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}
