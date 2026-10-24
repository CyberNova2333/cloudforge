// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// PostToolUse (Write|Edit): block leftover focused/skipped tests.
// Config: testGlobs ([ "**/*.test.ts", … ]).
import { readFileSync } from "node:fs";
import { readHookInput, loadConfig, matchesGlob, targetFile } from "./_lib.mjs";

const input = await readHookInput();
const file = targetFile(input);
const configuredGlobs = loadConfig().testGlobs;
const globs = Array.isArray(configuredGlobs) ? configuredGlobs : [];
if (!file || !globs.some((g) => matchesGlob(file, g))) process.exit(0);

let source;
try {
  source = readFileSync(file, "utf8");
} catch {
  process.exit(0);
}

const { findFocusedTests } = await import("./_focused-tests.mjs");
const hits = findFocusedTests(source, file).map(
  ({ line, snippet }) => `  ${file}:${line}  ${snippet}`,
);

if (hits.length === 0) process.exit(0);

process.stderr.write(
  `Focused or skipped tests left in the file just written:\n\n${hits.join("\n")}\n\n` +
    `\`.only\` silently skips every other test in the suite, and \`.skip\` disables coverage — ` +
    `both pass CI while testing nothing. Remove them before finishing.\n`,
);
process.exit(2);
