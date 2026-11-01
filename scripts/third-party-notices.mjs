#!/usr/bin/env node
// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Writes THIRD_PARTY_NOTICES.md from the installed tree, or checks it is current (`--check`).
 *
 * Derived, never hand-edited: rows come from the installed tree, and the Artifact column comes from
 * the banners `build/license-banners.ts` wrote into the last client build, so a package only counts
 * as shipped once a build emitted it. Run `yarn build` first when dependencies changed.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT = 'THIRD_PARTY_NOTICES.md';
const CLIENT_DIR = 'dist/client';
const CLIENT_ASSET_DIR = join(CLIENT_DIR, 'assets');
const EXCEPTIONS_FILE = 'scripts/third-party-notices.exceptions.json';
// The generator writes this line too, so the file it produces is the file that is committed.
const FORK_NOTICE =
  '<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->';
const FONT_PACKAGES = [
  '@fontsource/figtree',
  '@fontsource/ibm-plex-mono',
  '@fontsource/inter-tight',
];

// SPDX identifier → name shown in the table. Parsed, never invented.
const SPDX_NAMES = {
  '0BSD': '0BSD',
  'Apache-2.0': 'Apache-2.0',
  'BSD-2-Clause': 'BSD-2-Clause',
  'BSD-3-Clause': 'BSD-3-Clause',
  'CC0-1.0': 'CC0-1.0',
  'EPL-2.0': 'EPL-2.0',
  'GPL-3.0-or-later': 'GPL-3.0-or-later',
  ISC: 'ISC',
  'LGPL-3.0': 'LGPL-3.0',
  'LGPL-3.0-or-later': 'LGPL-3.0-or-later',
  MIT: 'MIT',
  'MIT-0': 'MIT-0',
  'MPL-2.0': 'MPL-2.0',
  'OFL-1.1': 'OFL-1.1',
  Unlicense: 'Unlicense',
  WTFPL: 'WTFPL',
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const cwd = process.cwd();

// Licenses that cannot ship inside a GPL-3.0-or-later work without a recorded decision.
const BROADER = /^(A?GPL-|SSPL-|BUSL-|CC-BY-NC|Commons-Clause)/i;
const WEAK = /^(MPL-|EPL-|LGPL-)/i;

/** Node resolution for `name` from `from`: nearest node_modules wins. */
function resolvePackage(name, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = join(dir, '..');
    if (parent === dir || !dir.includes('node_modules')) return null;
    dir = parent;
  }
}

/**
 * Walks `dependencies` (and installed optional dependencies) from package.json. Mirrors what a
 * bundler can see, so a package that only `devDependencies` pull in stays out.
 */
function distributedPackages(root) {
  const pkgJson = readJson(join(root, 'package.json'));
  const distributed = new Map();
  const missing = [];
  const noted = new Set();
  const queue = Object.keys(pkgJson.dependencies).map((name) => ({
    name,
    from: root,
    requiredBy: 'package.json',
    optional: false,
  }));
  while (queue.length) {
    const { name, from, requiredBy, optional } = queue.pop();
    const dir = resolvePackage(name, from);
    // Optional dependencies are platform-specific (sharp, esbuild); only the matching ones install.
    if (!dir) {
      if (!optional) missing.push(`${name} (required by ${requiredBy})`);
      continue;
    }
    if (noted.has(dir)) continue;
    noted.add(dir);
    const pkg = readJson(join(dir, 'package.json'));
    const license = licenseOf(pkg, dir);
    distributed.set(`${pkg.name}@${pkg.version}`, {
      name: pkg.name,
      version: pkg.version,
      license,
      dir,
      repository: pkg.repository,
      homepage: pkg.homepage,
    });
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      queue.push({
        name: dep,
        from: dir,
        requiredBy: `${pkg.name}@${pkg.version}`,
        optional: false,
      });
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      queue.push({
        name: dep,
        from: dir,
        requiredBy: `${pkg.name}@${pkg.version}`,
        optional: true,
      });
    }
  }
  return { distributed, missing };
}

function serializedLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  return null;
}

/** The `license` field, falling back to the LICENSE file when the manifest is silent. */
function licenseOf(pkg, dir) {
  const declared = serializedLicense(pkg);
  if (declared) return declared;
  const file = readdirSync(dir).find((f) =>
    /^(licen[cs]e|copying)(\.|$)/i.test(f)
  );
  if (!file) return 'NONE';
  const text = readFileSync(join(dir, file), 'utf8');
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(text)) return 'LGPL-3.0';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(text)) return 'GPL-3.0-only';
  if (/Mozilla Public License/i.test(text)) return 'MPL-2.0';
  if (/^The MIT License/im.test(text)) return 'MIT';
  return 'NONE';
}

/** Packages named by the `/*! Third-party software bundled … *\/` banners in `assetDir`. */
function bannedPackages(assetDir) {
  const names = new Map();
  if (!existsSync(assetDir)) return names;
  for (const file of readdirSync(assetDir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(assetDir, file), 'utf8');
    const start = source.indexOf('Third-party software bundled in this file:');
    if (start < 0) continue;
    const end = source.indexOf('*/', start);
    for (const [, name, version] of source
      .slice(start, end)
      .matchAll(/^([@\w][\w@./-]*)@(\d[\w.+-]*)(?: — .*)?$/gm)) {
      if (!names.has(name)) names.set(name, new Set());
      names.get(name).add(version);
    }
  }
  return names;
}

/** SPDX expression → display text, one identifier at a time; unknown identifiers stay verbatim. */
function licenseLabel(license) {
  return license
    .split(/\s+(OR|AND)\s+/)
    .map((part) =>
      part === 'OR' || part === 'AND' ? part : (SPDX_NAMES[part] ?? part)
    )
    .join(' ');
}

/** `repository` may be a URL, a `type:url` pair, or the `owner/repo` shorthand. */
function sourceOf(pkg) {
  const raw =
    [pkg.repository?.url ?? pkg.repository, pkg.homepage].find(Boolean) ?? '';
  const url = String(raw).trim();
  if (!url) return '—';
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

/** The first "Copyright …" line of a package's license file, as shipped. */
function copyrightOf(dir) {
  const file = readdirSync(dir).find((f) =>
    /^(licen[cs]e|copying)(\.|$)/i.test(f)
  );
  if (!file) return null;
  // Font packages repeat one statement per face ("Foo.ttf: Copyright …"); the first covers the family.
  const line = readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .map((text) => text.trim())
    .find((text) => /^copyright/i.test(text));
  if (!line) return null;
  const host = line.match(/\(https?:\/\/[^)]+\)/)?.[0] ?? '';
  const statement = line
    .split(/\s+\S+\.(ttf|otf|woff2?):/)[0]
    .replace(host, '')
    .trim();
  return `${statement} ${host}`.trim();
}

/**
 * A padded table. Every column is padded, the last one included: Prettier owns markdown formatting,
 * so the generator produces what `prettier --write` would.
 */
function table(header, rows) {
  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...rows.map((row) => row[i].length))
  );
  const line = (cells) =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;
  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ];
}

function kwarg(name) {
  return process.argv.includes(name);
}

// ── derive ────────────────────────────────────────────────────────────────────────────────

export function main({
  root = cwd,
  check = kwarg('--check'),
  write = !check,
} = {}) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const read = (file) =>
    existsSync(join(root, file))
      ? readFileSync(join(root, file), 'utf8')
      : null;
  const { distributed, missing } = distributedPackages(root);
  for (const name of missing)
    fail(`依赖未安装：${name}（先 yarn install --frozen-lockfile）`);

  const exceptions = read(EXCEPTIONS_FILE)
    ? JSON.parse(read(EXCEPTIONS_FILE))
    : {};
  const reasons = new Map((exceptions.reasons ?? []).map((r) => [r.name, r]));

  const clientBanned = bannedPackages(join(root, CLIENT_ASSET_DIR));
  for (const [name, versions] of clientBanned) {
    for (const version of versions) {
      if (!distributed.has(`${name}@${version}`)) {
        fail(
          `客户端产物里的 ${name}@${version} 不在依赖树内：构建产物与 ${'package.json'} 不匹配`
        );
      }
    }
  }

  const inClient = (name) => clientBanned.has(name);

  for (const pkg of distributed.values()) {
    const id = `${pkg.name}@${pkg.version}`;
    if (BROADER.test(pkg.license)) {
      fail(`${id} 是 ${pkg.license}，与 GPL-3.0-or-later 分发不兼容`);
      continue;
    }
    if (!WEAK.test(pkg.license)) continue;
    const entry = reasons.get(pkg.name) ?? reasons.get(id);
    if (!entry) {
      fail(
        `${id} 是弱 copyleft ${pkg.license}，需在 ${EXCEPTIONS_FILE} 写明处置与理由`
      );
    } else if (entry.placement === 'client' && !inClient(pkg.name)) {
      fail(`${id} 记为打进客户端产物，但上一次构建没有它，重新构建后再生成`);
    } else if (entry.placement === 'worker' && inClient(pkg.name)) {
      fail(`${id} 记为只在 Worker 侧，但客户端产物里也有它`);
    } else if (entry.placement === 'none') {
      fail(`${id} 记为不进任何产物，但它仍在依赖树内，先解除依赖再更新清单`);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────────────────────

  const byLicense = new Map();
  for (const pkg of [...distributed.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const label = licenseLabel(pkg.license);
    if (!byLicense.has(label)) byLicense.set(label, []);
    byLicense.get(label).push(pkg);
  }

  const lines = [];
  lines.push(
    FORK_NOTICE,
    '',
    '# Third-party notices',
    '',
    '<!-- Generated by `yarn notices` from the installed tree. Do not edit by hand. -->',
    '',
    'CloudForge is distributed under GPL-3.0-or-later (`LICENSE`). It is a fork of GitOrange, whose',
    'original portions remain under the Apache License 2.0 (`LICENSES/Apache-2.0.txt`, unchanged,',
    '"Copyright 2026 GitOrange contributors").',
    '',
    `The build ships ${distributed.size} packages: everything reachable from \`dependencies\` in`,
    '`package.json`, plus optional dependencies that installed. Each keeps its own license, and',
    "`build/license-banners.ts` prepends each bundled package's license and copyright to the client",
    'file it ends up in. Development tooling (`devDependencies`) is not distributed.',
    '',
    `The client bundle is the record of what a browser downloads: Rollup drops whatever the app never`,
    `imports, and that shows up in the column below. The worker bundle keeps no legal comments, so a`,
    'Worker-side package is covered by this file rather than by a banner.',
    ''
  );

  const copyleft = [...distributed.values()].filter((pkg) =>
    WEAK.test(pkg.license)
  );
  lines.push('## Copyleft components', '');
  if (!copyleft.length) {
    lines.push('None.', '');
  } else {
    lines.push(
      "These are the only components under a copyleft license other than this project's own. Every",
      'other package is MIT, Apache-2.0, ISC, BSD, OFL, Unlicense, 0BSD or MIT-0, or may be taken on',
      'that side of an `OR`.',
      ''
    );
    lines.push(
      ...table(
        ['Package', 'License', 'What it does', 'Ship'],
        copyleft
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((pkg) => {
            const entry =
              reasons.get(pkg.name) ??
              reasons.get(`${pkg.name}@${pkg.version}`) ??
              {};
            return [
              `\`${pkg.name}@${pkg.version}\``,
              `\`${pkg.license}\``,
              entry.does ?? '—',
              inClient(pkg.name) ? 'client' : 'worker',
            ];
          })
      ),
      ''
    );
    const notes = copyleft
      .map((pkg) => [
        pkg,
        reasons.get(pkg.name) ?? reasons.get(`${pkg.name}@${pkg.version}`),
      ])
      .filter(([, entry]) => entry);
    for (const [pkg, entry] of notes)
      lines.push(`- **\`${pkg.name}\`** — ${entry.reason}`);
    if (notes.length) lines.push('');
  }

  const fonts = FONT_PACKAGES.map((name) =>
    [...distributed.values()].find((pkg) => pkg.name === name)
  );
  lines.push('## Fonts', '');
  lines.push(
    'Shipped as WOFF2 files with the OFL text and copyright line alongside them at',
    '`public/licenses/OFL-1.1.txt` (served at `/licenses/OFL-1.1.txt`).',
    ''
  );
  for (const pkg of fonts.filter(Boolean)) {
    lines.push(
      `- **\`${pkg.name}\`** ${pkg.version} — ${copyrightOf(pkg.dir) ?? 'copyright line in its LICENSE'}`
    );
  }
  lines.push('');

  lines.push('## Packages by license', '');
  const licenseRows = [...byLicense.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
  );
  lines.push(
    ...table(
      ['License', 'Packages'],
      licenseRows.map(([label, packages]) => [
        `\`${label}\``,
        String(packages.length),
      ])
    ),
    ''
  );

  for (const [label, packages] of licenseRows) {
    lines.push(`### ${label}`, '');
    lines.push(
      ...table(
        ['Package', 'Version', 'Artifact', 'Source'],
        packages.map((pkg) => [
          `\`${pkg.name}\``,
          pkg.version,
          inClient(pkg.name) ? 'client' : 'worker',
          sourceOf(pkg),
        ])
      ),
      ''
    );
  }

  if (failures.length) {
    console.error('第三方许可清单：检查未通过');
    for (const failure of [...new Set(failures)])
      console.error(`  - ${failure}`);
  }

  const next = `${lines.join('\n').trimEnd()}\n`;
  const current = (read(OUTPUT) ?? '').replace(/\r\n/g, '\n');

  const changed = current !== next;
  if (changed && write) writeFileSync(join(root, OUTPUT), next);
  return { changed, failures, packages: distributed.size, content: next };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { changed, failures, packages } = main();
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
  if (failures.length) console.error('第三方许可清单：检查未通过');
  else if (kwarg('--check') && changed)
    console.error(
      `第三方许可清单：${OUTPUT} 与安装树不一致，运行 yarn notices 重新生成`
    );
  else
    console.log(
      `第三方许可清单：${OUTPUT} ${changed ? '已写入' : '已是最新'}（${packages} 个包）`
    );
  if (failures.length || (kwarg('--check') && changed)) process.exitCode = 1;
}
