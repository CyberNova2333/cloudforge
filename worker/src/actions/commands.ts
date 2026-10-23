// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
/** Parses `$GITHUB_ENV`/`$GITHUB_OUTPUT`: `NAME=value` lines or `NAME<<EOF` … `EOF` heredocs. */
export function parseKeyValueFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim()) continue;
    const heredoc = /^([^=<\s]+)<<(.+)$/.exec(line);
    if (heredoc) {
      const [, name, delim] = heredoc;
      const value: string[] = [];
      i++;
      while (i < lines.length && lines[i].replace(/\r$/, '') !== delim)
        value.push(lines[i++]);
      out[name] = value.join('\n');
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** A line of a multi-line value is masked on its own only from this length, and only with a letter or digit. */
const MIN_LINE_MASK = 4;

/**
 * What one secret or add-mask value hides: the value itself, however short, and each line of a multi-line value
 * that could be secret on its own. A line like `{` or `}` (a JSON key file) would otherwise hide every brace in the log.
 */
export function maskValues(value: string): string[] {
  if (!value) return [];
  const out = [value];
  if (value.includes('\n'))
    for (const raw of value.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length >= MIN_LINE_MASK && /[A-Za-z0-9]/.test(line))
        out.push(line);
    }
  return out;
}

export function parsePathFile(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Replaces every registered secret, including short values. */
export function mask(text: string, secrets: string[]): string {
  let covered: Uint8Array | undefined;
  for (const secret of new Set(secrets)) {
    if (!secret) continue;
    const first = text.indexOf(secret);
    if (first < 0) continue;
    covered ??= new Uint8Array(text.length);
    // KMP includes crossing/self-overlapping occurrences, without rescanning a
    // long secret at every character or allocating an interval per match.
    const prefix = new Uint32Array(secret.length);
    for (let i = 1, matched = 0; i < secret.length; i++) {
      while (matched && secret[i] !== secret[matched])
        matched = prefix[matched - 1];
      if (secret[i] === secret[matched]) matched++;
      prefix[i] = matched;
    }
    let coveredEnd = first;
    for (let i = first, matched = 0; i < text.length; i++) {
      while (matched && text[i] !== secret[matched])
        matched = prefix[matched - 1];
      if (text[i] === secret[matched]) matched++;
      if (matched === secret.length) {
        const end = i + 1;
        // Every character is marked at most once per secret, even for a long
        // repeated value such as "aaaa" in a newline-free log.
        covered.fill(1, Math.max(coveredEnd, end - secret.length), end);
        coveredEnd = end;
        matched = prefix[matched - 1];
      }
    }
  }
  if (!covered) return text;
  const chunks: string[] = [];
  let chunk = '';
  for (let i = 0; i < text.length;) {
    const start = i;
    const hidden = covered[i];
    while (i < text.length && covered[i] === hidden) i++;
    chunk += hidden ? '***' : text.slice(start, i);
    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  chunks.push(chunk);
  return chunks.join('');
}

/** Undoes GitHub's escaping of workflow command values (`%25` `%0D` `%0A`). */
const unescapeCommand = (v: string) =>
  v.replace(/%0D/gi, '\r').replace(/%0A/gi, '\n').replace(/%25/g, '%');

/**
 * Applies the workflow commands an action prints (`::name args::value`, as written by @actions/core) to a step's
 * log: `add-mask` values are collected and hidden, `group`/`endgroup` become headings, `debug` lines are dropped,
 * `error`/`warning`/`notice` become labelled lines. Everything else is left as printed.
 */
export function workflowCommands(text: string): {
  text: string;
  masks: string[];
} {
  const masks: string[] = [];
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^::([a-z-]+)(?: [^:]*)?::(.*)$/.exec(line.replace(/\r$/, ''));
    if (!m) {
      out.push(line);
      continue;
    }
    const [, name, raw] = m;
    const value = unescapeCommand(raw);
    switch (name) {
      case 'add-mask':
        if (value) masks.push(value);
        break;
      case 'group':
        out.push(`▸ ${value}`);
        break;
      case 'endgroup':
      case 'debug':
        break;
      case 'error':
        out.push(`Error: ${value}`);
        break;
      case 'warning':
        out.push(`Warning: ${value}`);
        break;
      case 'notice':
        out.push(`Notice: ${value}`);
        break;
      default:
        out.push(line);
    }
  }
  return { text: out.join('\n'), masks };
}
