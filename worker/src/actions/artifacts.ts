import { MAX_CACHE_ENTRY_BYTES, fromKeySegment, keySegment } from './cache';

/**
 * Build artifacts (actions/upload-artifact, actions/download-artifact): one zip per artifact in the
 * ACTIONS_CACHE bucket at `actions-artifacts/<repository id>/<run id>/<name>/<job id>-<step>.zip`. As with the
 * cache, R2's listing is the only index (no table), and runners move the bytes through pre-signed URLs. The
 * object key says which step wrote it: running that step again (a restarted job) replaces its own zip, while
 * another step reusing the name needs `overwrite: true`. Artifacts live as long as their run: the Actions
 * retention and repository deletion remove them.
 */

export const artifactsPrefix = (repositoryId: string) =>
  `actions-artifacts/${repositoryId}/`;

export const runArtifactsPrefix = (repositoryId: string, runId: string) =>
  `${artifactsPrefix(repositoryId)}${runId}/`;

const namePrefix = (repositoryId: string, runId: string, name: string) =>
  `${runArtifactsPrefix(repositoryId, runId)}${keySegment(name)}/`;

export const artifactObjectKey = (
  repositoryId: string,
  runId: string,
  name: string,
  jobId: string,
  step: number
) => `${namePrefix(repositoryId, runId, name)}${keySegment(jobId)}-${step}.zip`;

/** GitHub's rule for artifact names; null when `name` is fine. */
export function artifactNameError(name: string): string | null {
  if (!name) return 'The artifact name is empty.';
  if (name.length > 255) return 'The artifact name is over 255 characters.';
  const bad = name.match(/["':<>|*?\\/\r\n]/);
  if (bad)
    return `The artifact name '${name}' contains '${bad[0] === '\n' ? '\\n' : bad[0] === '\r' ? '\\r' : bad[0]}', which artifact names can't contain (" : < > | * ? \\ / and line breaks).`;
  return null;
}

export interface Artifact {
  name: string;
  /** Stable within the run; what upload-artifact's `artifact-id` output gives and `artifact-ids` takes. */
  id: string;
  size: number;
  createdAt: Date;
  objectKey: string;
  jobId: string;
}

async function listAll(bucket: R2Bucket, prefix: string) {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** A run's artifacts, by name. Where two steps wrote one name (an overwrite in flight), the newest wins. */
export async function listRunArtifacts(
  env: CloudflareBindings,
  repositoryId: string,
  runId: string
): Promise<Artifact[]> {
  const bucket = (env as Partial<CloudflareBindings>).ACTIONS_CACHE;
  if (!bucket) return [];
  const prefix = runArtifactsPrefix(repositoryId, runId);
  const byName = new Map<string, Artifact>();
  for (const o of await listAll(bucket, prefix)) {
    const m = /^([^/]+)\/(.+)-(\d+)\.zip$/.exec(o.key.slice(prefix.length));
    if (!m) continue;
    const a: Artifact = {
      name: fromKeySegment(m[1]),
      id: m[1],
      size: o.size,
      createdAt: o.uploaded,
      objectKey: o.key,
      jobId: fromKeySegment(m[2]),
    };
    const seen = byName.get(a.name);
    if (!seen || seen.createdAt < a.createdAt) byName.set(a.name, a);
  }
  // By code point: the same order everywhere (localeCompare depends on the runtime's locale data).
  return [...byName.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
}

/** Object keys already holding artifact `name` in the run (normally zero or one). */
export async function artifactObjects(
  env: CloudflareBindings,
  repositoryId: string,
  runId: string,
  name: string
): Promise<string[]> {
  return (
    await listAll(env.ACTIONS_CACHE, namePrefix(repositoryId, runId, name))
  ).map((o) => o.key);
}

export async function deleteArtifact(env: CloudflareBindings, a: Artifact) {
  const keys = (
    await listAll(
      env.ACTIONS_CACHE,
      `${a.objectKey.slice(0, a.objectKey.lastIndexOf('/') + 1)}`
    )
  ).map((o) => o.key);
  if (keys.length) await env.ACTIONS_CACHE.delete(keys);
}

async function deletePrefix(env: CloudflareBindings, prefix: string) {
  const bucket = (env as Partial<CloudflareBindings>).ACTIONS_CACHE;
  if (!bucket) return;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length)
      await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export const deleteRunArtifacts = (
  env: CloudflareBindings,
  repositoryId: string,
  runId: string
) => deletePrefix(env, runArtifactsPrefix(repositoryId, runId));

export const deleteRepositoryArtifacts = (
  env: CloudflareBindings,
  repositoryId: string
) => deletePrefix(env, artifactsPrefix(repositoryId));

// ── runner scripts ───────────────────────────────────────────────────────────

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Finds the files like upload-artifact does (globs with `**`, `!` excludes, hidden files left out unless asked)
 * and zips them relative to the search paths' least common ancestor, so `path: dist/` stores dist's contents
 * at the root. Reads ARTIFACT_PATHS, ARTIFACT_NAME, ARTIFACT_IF_NO_FILES, ARTIFACT_LEVEL and ARTIFACT_HIDDEN;
 * writes /tmp/gitorange-artifact.zip (absent when there was nothing to upload).
 */
const ZIP_PY = String.raw`
import glob, hashlib, os, sys, zipfile
ws = os.environ.get('GITHUB_WORKSPACE') or os.getcwd()
name = os.environ['ARTIFACT_NAME']
lines = [l.strip() for l in os.environ['ARTIFACT_PATHS'].split('\n') if l.strip()]
hidden = os.environ.get('ARTIFACT_HIDDEN') == 'true'
level = int(os.environ.get('ARTIFACT_LEVEL') or '6')
mode = os.environ.get('ARTIFACT_IF_NO_FILES') or 'warn'
include = [l for l in lines if not l.startswith('!')]
exclude = [l[1:].strip() for l in lines if l.startswith('!')]
wild = lambda p: any(c in p for c in '*?[')
absp = lambda p: os.path.normpath(os.path.join(ws, os.path.expanduser(p)))
def expand(p):
    a = absp(p)
    found = glob.glob(a, recursive=True, include_hidden=True) if wild(a) else ([a] if os.path.exists(a) else [])
    files = set()
    for m in found:
        if os.path.isdir(m):
            for d, _, fs in os.walk(m):
                files.update(os.path.join(d, f) for f in fs)
        elif os.path.isfile(m):
            files.add(m)
    return files
def root_of(p):
    parts = absp(p).split(os.sep)
    for i, part in enumerate(parts):
        if wild(part):
            return os.sep.join(parts[:i]) or os.sep
    a = absp(p)
    return a if os.path.isdir(a) else os.path.dirname(a)
files = set()
for p in include:
    files |= expand(p)
for p in exclude:
    files -= expand(p)
root = os.path.commonpath([root_of(p) for p in include])
if not hidden:
    files = {f for f in files if not any(s.startswith('.') for s in os.path.relpath(f, root).split(os.sep))}
if not files:
    msg = 'No files were found with the provided path: %s.' % ', '.join(lines)
    if mode == 'error':
        print('Error: ' + msg + ' No artifacts will be uploaded.')
        sys.exit(1)
    print(('Warning: ' if mode == 'warn' else '') + msg + ' No artifacts will be uploaded.')
    sys.exit(0)
out = '/tmp/gitorange-artifact.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED if level else zipfile.ZIP_STORED, compresslevel=level or None) as z:
    for f in sorted(files):
        z.write(f, os.path.relpath(f, root))
size = os.path.getsize(out)
h = hashlib.sha256()
with open(out, 'rb') as fh:
    for chunk in iter(lambda: fh.read(1 << 20), b''):
        h.update(chunk)
with open('/tmp/gitorange-artifact.sha256', 'w') as fh:
    fh.write(h.hexdigest())
print("With the provided path, there will be %d file%s uploaded as '%s' (%d bytes zipped)." % (len(files), '' if len(files) == 1 else 's', name, size))
`;

/** Zips the files and PUTs them to `$ARTIFACT_URL`; sets artifact-id, artifact-url and artifact-digest. */
export function uploadScript(opts: {
  id: string;
  url: string;
  retentionDays?: string;
}): string {
  return [
    'set -e',
    'rm -f /tmp/gitorange-artifact.zip /tmp/gitorange-artifact.sha256',
    ...(opts.retentionDays
      ? [
          `echo ${quote('Note: retention-days is not used here; artifacts are kept as long as their run (the Actions retention setting).')}`,
        ]
      : []),
    `python3 - <<'GITORANGE_ZIP'\n${ZIP_PY.trim()}\nGITORANGE_ZIP`,
    '[ -f /tmp/gitorange-artifact.zip ] || exit 0',
    'size=$(stat -c %s /tmp/gitorange-artifact.zip)',
    `if [ "$size" -gt ${MAX_CACHE_ENTRY_BYTES} ]; then echo "Error: the artifact is $size bytes zipped, over the 5 GB limit."; rm -f /tmp/gitorange-artifact.zip; exit 1; fi`,
    'curl -fsS --retry 3 -X PUT -H "Content-Type: application/zip" -T /tmp/gitorange-artifact.zip "$ARTIFACT_URL" -o /dev/null',
    'rm -f /tmp/gitorange-artifact.zip',
    `echo "Artifact '$ARTIFACT_NAME' uploaded."`,
    `echo ${quote(`artifact-id=${opts.id}`)} >> "$GITHUB_OUTPUT"`,
    `echo ${quote(`artifact-url=${opts.url}`)} >> "$GITHUB_OUTPUT"`,
    '[ -f /tmp/gitorange-artifact.sha256 ] && echo "artifact-digest=$(cat /tmp/gitorange-artifact.sha256)" >> "$GITHUB_OUTPUT"',
    'rm -f /tmp/gitorange-artifact.sha256',
  ].join('\n');
}

/** Downloads each artifact (`$ARTIFACT_URL_<i>`) and unzips it into its directory; sets download-path. */
export function downloadScript(
  items: { name: string; dir: string }[],
  downloadPath: string
): string {
  return [
    'set -e',
    `mkdir -p ${quote(downloadPath)}`,
    ...items.flatMap((a, i) => [
      `echo ${quote(`Downloading artifact '${a.name}' to ${a.dir}`)}`,
      `mkdir -p ${quote(a.dir)}`,
      `curl -fsSL --retry 3 "$ARTIFACT_URL_${i}" -o /tmp/gitorange-artifact-${i}.zip`,
      `unzip -oq /tmp/gitorange-artifact-${i}.zip -d ${quote(a.dir)}`,
      `rm -f /tmp/gitorange-artifact-${i}.zip`,
    ]),
    `echo ${quote(`Downloaded ${items.length} artifact${items.length === 1 ? '' : 's'}.`)}`,
    `echo ${quote(`download-path=${downloadPath}`)} >> "$GITHUB_OUTPUT"`,
  ].join('\n');
}
