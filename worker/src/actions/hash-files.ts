// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * `hashFiles()`, run in the job's container (as GitHub runs it on the runner, so files earlier steps made count).
 * A Node.js program: patterns come as JSON in HASH_PATTERNS, `--follow-symbolic-links` as HASH_FOLLOW=1; it
 * prints the hash (empty when nothing matched) or fails with the reason on stderr.
 *
 * Same as GitHub's runner: patterns are matched like @actions/glob (relative to the workspace, `**`, `!` to
 * exclude with later patterns winning, dotfiles included, a matched directory includes everything under it,
 * symbolic links to directories not followed unless asked); files outside the workspace and directories are
 * skipped; the result is the SHA-256 over each file's SHA-256 digest. Files are taken in sorted path order
 * (GitHub takes them in directory listing order, which only differs when several files match).
 */
export const HASH_FILES_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.cwd();
const realRoot = fs.realpathSync(root);
const inside = (p, base = root) => p === base || p.startsWith(base + '/');
const follow = process.env.HASH_FOLLOW === '1';
const raw = JSON.parse(process.env.HASH_PATTERNS || '[]');

function segmentRe(seg) {
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = seg.indexOf(']', i + 2);
      if (end < 0) { out += '\\['; continue; }
      let body = seg.slice(i + 1, end);
      if (body[0] === '!') body = '^' + body.slice(1);
      out += '[' + body.replace(/\\/g, '\\\\') + ']';
      i = end;
    } else out += c.replace(/[.+^\${}()|\\\]]/g, '\\$&');
  }
  return out;
}

const hasGlob = (s) => /[*?[]/.test(s);
const patterns = [];
for (let line of raw.flatMap((p) => String(p).split('\n'))) {
  line = line.trim();
  if (!line || line.startsWith('#')) continue;
  let negate = false;
  while (line.startsWith('!')) { negate = !negate; line = line.slice(1).trim(); }
  if (line === '~' || line.startsWith('~/')) line = path.join(require('os').homedir(), line.slice(1));
  const dirOnly = line.endsWith('/');
  let abs = path.posix.resolve(root, line);
  const segs = abs.split('/').filter(Boolean);
  let re = '';
  for (const s of segs) re += s === '**' ? '(?:/[^/]+)*' : '/' + segmentRe(s);
  // A pattern that matches a directory also matches everything under it (@actions/glob implicitDescendants).
  const tail = segs[segs.length - 1] === '**' ? '' : dirOnly ? '/.+' : '(?:/.+)?';
  const literal = [];
  for (const s of segs) { if (hasGlob(s)) break; literal.push(s); }
  patterns.push({ negate, re: new RegExp('^' + (re || '') + tail + '$'), search: '/' + literal.join('/') });
}

function included(p) {
  let yes = false;
  for (const pat of patterns) if (pat.re.test(p)) yes = !pat.negate;
  return yes;
}

const files = new Set();
const seen = new Set();
function walk(p) {
  if (!inside(p)) return;
  let st;
  try { st = follow ? fs.statSync(p) : fs.lstatSync(p); } catch { return; }
  if (st.isDirectory()) {
    let real;
    try { real = fs.realpathSync(p); } catch { return; }
    if (!inside(real, realRoot) || seen.has(real)) return;
    seen.add(real);
    for (const name of fs.readdirSync(p).sort()) walk(p === '/' ? '/' + name : p + '/' + name);
    seen.delete(real);
  } else if (included(p)) files.add(p);
}
for (const pat of patterns) if (!pat.negate) {
  // A broad search prefix may be an ancestor of the workspace; never walk the rest of the host.
  if (inside(root, pat.search)) walk(root);
  else if (inside(pat.search)) walk(pat.search);
}

const total = crypto.createHash('sha256');
let count = 0;
for (const file of [...files].sort()) {
  if (!file.startsWith(root + '/')) continue;
  let st;
  try { st = fs.statSync(file); } catch { continue; }
  // Do not hash devices/FIFOs or follow a file symlink outside the workspace.
  if (!st.isFile() || !inside(fs.realpathSync(file), realRoot)) continue;
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  total.update(h.digest());
  count++;
}
process.stdout.write(count ? total.digest('hex') : '');
`;
