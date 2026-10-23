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

export function parsePathFile(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Replaces every registered secret, including short values. */
export function mask(text: string, secrets: string[]): string {
  let out = text;
  for (const s of [...secrets].sort((a, b) => b.length - a.length))
    if (s) out = out.split(s).join('***');
  return out;
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
