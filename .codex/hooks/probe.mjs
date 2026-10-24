// A Codex hook that only records what it is given, to learn Codex's real hook payloads before the .claude/hooks
// checks (format on edit, protected files, focused tests, typecheck on stop) are ported. It decides nothing and always
// exits 0, so it never blocks or changes what Codex does. Each call appends one JSON line to .codex/hook-probe.log
// (gitignored): the payload, the working directory, and the CODEX_*/CLAUDE_* environment variable names.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'hook-probe.log'
);

try {
  let raw = '';
  if (!process.stdin.isTTY)
    for await (const chunk of process.stdin) raw += chunk;
  let payload = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Keep it as text: the format is what this probe is for.
  }
  appendFileSync(
    LOG,
    JSON.stringify({
      at: new Date().toISOString(),
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      env: Object.keys(process.env)
        .filter((k) => /^(CODEX|CLAUDE)/i.test(k))
        .sort(),
      payload,
    }) + '\n'
  );
} catch {
  // A probe must never get in the way.
}
process.exit(0);
