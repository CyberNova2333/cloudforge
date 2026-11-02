#!/usr/bin/env node
// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Lists English UI text in the given files that is not wrapped in t()/tn()/tx() yet: JSX text, and string
// literals that read like words (attributes such as aria-label, title, placeholder included). A helper for
// translating (see src/lib/i18n.ts); it over-reports (class names, keys), so read each line before wrapping.
//   node scripts/i18n/i18n-strings.mjs src/pages/overview/Home.tsx src/components/shell/*.tsx
import fs from 'node:fs';

const jsxText = />([^<>{}]*[A-Za-z]{2}[^<>{}]*)</g;
const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
// Literal values that are code, not prose.
const code =
  /^(?:[a-z0-9]+(?:[-_./:#@][a-z0-9]+)*|[A-Z_]+|@\/.*|\.{0,2}\/.*|https?:.*|[a-z]+(?:[A-Z][a-z0-9]*)+|[\w-]+(?: [\w-]+)*-[\w-]+|.*\$\{.*|[^A-Za-z]*)$/;
// Already a key: the first argument of t()/tx(), or any literal argument of tn().
const wrapped = /\b(?:tx?\(\s*|tn\([^()]*)$/;

let total = 0;
for (const file of process.argv.slice(2)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('import ')
    )
      return;
    for (const m of line.matchAll(jsxText)) {
      const text = m[1].trim();
      if (text && /[A-Za-z]{2}/.test(text) && !/^[=>&|?:]/.test(text))
        hits.push(`${i + 1}: >${text}<`);
    }
    for (const m of line.matchAll(literal)) {
      const text = m[2];
      if (!/[A-Za-z]{2}/.test(text) || code.test(text)) continue;
      if (!/[A-Z]|\s/.test(text)) continue;
      if (wrapped.test(line.slice(0, m.index))) continue;
      hits.push(`${i + 1}: ${m[1]}${text}${m[1]}`);
    }
  });
  if (hits.length) {
    console.log(`== ${file} (${hits.length})`);
    for (const h of hits) console.log('  ' + h);
  }
  total += hits.length;
}
console.log(`total ${total}`);
