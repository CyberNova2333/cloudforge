// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
export type Comparison =
  | { kind: 'upgrade' | 'same' | 'downgrade' }
  | { kind: 'custom'; reason: string };

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT = /^[0-9a-f]{7,40}(-dirty)?$/;

function parse(v: string) {
  const m = SEMVER.exec(v.trim());
  if (!m) return null;
  return {
    nums: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : null,
  };
}

function comparePre(a: string[], b: string[]): -1 | 0 | 1 {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** x.y.z numeric; a prerelease sorts before its release. A non-semver string is not comparable: 0. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i]! < pb.nums[i]! ? -1 : 1;
  }
  if (pa.pre && pb.pre) return comparePre(pa.pre, pb.pre);
  if (pa.pre) return -1;
  if (pb.pre) return 1;
  return 0;
}

/**
 * Where the running version stands against the package's. A release (semver) compares by number. A commit (a worker
 * deployed from a checkout) is looked up in the commits the package lists (`history`, its `history.txt`, written by
 * pack.mjs from `git rev-list`): the package's own commit is the same, one it contains is an upgrade. Anything else
 * is custom code: a newer build or commits that are not in a release, which the list alone cannot tell apart.
 * Offline: the fork's repository is on CNB, whose API needs a token.
 */
export function compareRunning(
  running: string | null,
  pkg: { version: string; commit: string; history?: readonly string[] | null }
): Comparison {
  if (running === null)
    return { kind: 'custom', reason: 'the running version is unknown' };
  if (parse(running) && parse(pkg.version)) {
    const c = compareSemver(running, pkg.version);
    return { kind: c < 0 ? 'upgrade' : c > 0 ? 'downgrade' : 'same' };
  }
  if (!COMMIT.test(running))
    return {
      kind: 'custom',
      reason: `the running version "${running}" is not a release or a commit`,
    };
  if (running.endsWith('-dirty'))
    return { kind: 'custom', reason: 'uncommitted changes' };
  if (!pkg.commit || !pkg.history?.length)
    return {
      kind: 'custom',
      reason: `this package does not list the commits of ${pkg.version}, so commit ${running} cannot be checked`,
    };
  if (pkg.commit.startsWith(running)) return { kind: 'same' };
  if (pkg.history.some((sha) => sha.startsWith(running)))
    return { kind: 'upgrade' };
  return {
    kind: 'custom',
    reason: `commit ${running} is not in ${pkg.version} (a newer build, or commits that are not in a release)`,
  };
}

/** dist-tags.latest from the npm registry; null on any failure. */
export async function latestOnNpm(
  fetchImpl: typeof fetch
): Promise<string | null> {
  try {
    const res = await fetchImpl(
      'https://registry.npmjs.org/@cybernova2333%2fcloudforge',
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      'dist-tags'?: { latest?: unknown };
    };
    const latest = body['dist-tags']?.latest;
    return typeof latest === 'string' ? latest : null;
  } catch {
    return null;
  }
}
