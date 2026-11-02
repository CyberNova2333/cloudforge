#!/usr/bin/env node
// Prints the t()/tn()/tx() keys used in the given files that src/locales/zh has no entry for, as lines ready
// to paste into an area file ('key': '',). The same key rules as src/lib/i18n.test.ts.
//   node scripts/i18n/i18n-missing.mjs src/components/shell/*.tsx
import fs from 'node:fs';
import path from 'node:path';

const STR = String.raw`(['"])((?:\\.|(?!\1)[^\\])*)\1`;
const unescape = (s) => s.replace(/\\(.)/g, '$1');

function keysIn(src) {
  const keys = [];
  for (const m of src.matchAll(new RegExp(String.raw`\btx?\(\s*${STR}`, 'g')))
    keys.push(unescape(m[2]));
  const tn = new RegExp(
    String.raw`\btn\(\s*[^,]+,\s*${STR}\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3`,
    'g'
  );
  for (const m of src.matchAll(tn)) keys.push(unescape(m[2]), unescape(m[4]));
  return keys;
}

// Every key already translated, read from the area files' source (no TypeScript loader needed).
const dir = path.join('src', 'locales', 'zh');
const known = new Set();
for (const f of fs.readdirSync(dir)) {
  if (f === 'index.ts') continue;
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(new RegExp(String.raw`^\s*${STR}\s*:`, 'gm')))
    known.add(unescape(m[2]));
  for (const m of src.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) known.add(m[1]);
}

const missing = new Set();
for (const file of process.argv.slice(2))
  for (const key of keysIn(fs.readFileSync(file, 'utf8')))
    if (!known.has(key)) missing.add(key);
for (const key of missing) console.log(`  ${JSON.stringify(key)}: '',`);
console.error(`${missing.size} missing`);
