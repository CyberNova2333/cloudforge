// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const CLIENT_DIR = path.join(ROOT_DIR, 'dist', 'client');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const USER_ADA = {
  id: 'usr-ada',
  username: 'ada',
  name: 'Ada Lovelace',
  image: null,
};

const USER_LINUS = {
  id: 'usr-linus',
  username: 'torvalds',
  name: 'Linus Torvalds',
  image: null,
};

const OWNER_ACME = {
  id: 'team-acme',
  username: 'acme',
  name: 'Acme Engineering',
  image: null,
};

const COMMIT_1_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const COMMIT_2_SHA = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const COMMIT_3_SHA = 'c3d4e5f60718293a4b5c6d7e8f90123456789012';
const COMMIT_4_SHA = 'd4e5f60718293a4b5c6d7e8f9012345678901234';

// Fixed timestamps in 2026-10-31 and 2026-10-30 (seconds)
const TS_DAY_1_A = 1793448000; // 2026-10-31T12:00:00Z
const TS_DAY_1_B = 1793437200; // 2026-10-31T09:00:00Z
const TS_DAY_2_A = 1793361600; // 2026-10-30T12:00:00Z
const TS_DAY_2_B = 1793350800; // 2026-10-30T09:00:00Z

const COMMITS = [
  {
    hash: COMMIT_1_SHA,
    treeHash: '1111111111111111111111111111111111111111',
    message:
      'feat(git): enforce atomic CAS fast-forward on protected refs\n\nEnsure push_events are committed in the same D1 batch before replying to the Git Smart HTTP v2 client.\n\nCo-authored-by: Linus Torvalds <torvalds@cloudforge.dev>',
    author: {
      name: 'Ada Lovelace',
      email: 'ada@cloudforge.dev',
      user: USER_ADA,
    },
    committer: {
      name: 'Ada Lovelace',
      email: 'ada@cloudforge.dev',
      user: USER_ADA,
    },
    parents: [COMMIT_2_SHA],
    authoredAt: TS_DAY_1_A,
    committedAt: TS_DAY_1_A,
  },
  {
    hash: COMMIT_2_SHA,
    treeHash: '2222222222222222222222222222222222222222',
    message:
      'refactor(ui): align file browser table and diff viewer with Primer primitives for high-density readability across 1280px and 1920px viewports',
    author: {
      name: 'Linus Torvalds',
      email: 'torvalds@cloudforge.dev',
      user: USER_LINUS,
    },
    committer: {
      name: 'Linus Torvalds',
      email: 'torvalds@cloudforge.dev',
      user: USER_LINUS,
    },
    parents: [COMMIT_3_SHA],
    authoredAt: TS_DAY_1_B,
    committedAt: TS_DAY_1_B,
  },
  {
    hash: COMMIT_3_SHA,
    treeHash: '3333333333333333333333333333333333333333',
    message: 'fix(lfs): validate presigned R2 object keys per repository id',
    author: {
      name: 'Ada Lovelace',
      email: 'ada@cloudforge.dev',
      user: USER_ADA,
    },
    committer: {
      name: 'Ada Lovelace',
      email: 'ada@cloudforge.dev',
      user: USER_ADA,
    },
    parents: [COMMIT_4_SHA],
    authoredAt: TS_DAY_2_A,
    committedAt: TS_DAY_2_A,
  },
  {
    hash: COMMIT_4_SHA,
    treeHash: '4444444444444444444444444444444444444444',
    message: 'chore(init): bootstrap CloudForge edge worker and D1 schema',
    author: {
      name: 'Ada Lovelace',
      email: 'ada@cloudforge.dev',
      user: USER_ADA,
    },
    committer: {
      name: 'Ada Lovelace',
      email: 'ada@cloudforge.dev',
      user: USER_ADA,
    },
    parents: [],
    authoredAt: TS_DAY_2_B,
    committedAt: TS_DAY_2_B,
  },
];

const REPO_CLOUDFORGE = {
  id: 'repo-cloudforge',
  owner: OWNER_ACME,
  ownerType: 'team',
  visibility: 'public',
  name: 'cloudforge',
  fullName: 'acme/cloudforge',
  description:
    'Edge-native Git hosting server running on Cloudflare Workers, Durable Objects, D1, and R2.',
  defaultBranch: 'main',
  protectedBranches: ['main', 'release/*'],
  deleteMergedBranches: true,
  hasIssues: true,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-31T12:00:00.000Z',
  permissions: { read: true, write: true, admin: true },
  cloneUrl: 'http://cloudforge:8080/acme/cloudforge.git',
  empty: false,
  branches: [
    { name: 'main', sha: COMMIT_1_SHA },
    { name: 'feat/primer-tokens', sha: COMMIT_2_SHA },
    { name: 'fix/lfs-presign', sha: COMMIT_3_SHA },
  ],
  openPullCount: 3,
  openIssueCount: 5,
};

const REPO_EMPTY = {
  id: 'repo-empty',
  owner: OWNER_ACME,
  ownerType: 'team',
  visibility: 'internal',
  name: 'empty-repo',
  fullName: 'acme/empty-repo',
  description:
    'Uninitialised repository for testing empty state and quick setup.',
  defaultBranch: 'main',
  protectedBranches: ['main'],
  deleteMergedBranches: true,
  hasIssues: true,
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
  permissions: { read: true, write: true, admin: true },
  cloneUrl: 'http://cloudforge:8080/acme/empty-repo.git',
  empty: true,
  branches: [],
  openPullCount: 0,
  openIssueCount: 0,
};

const ROOT_ENTRIES = [
  {
    name: 'docs',
    path: 'docs',
    type: 'tree',
    mode: '040000',
    hash: 'aaaa1111',
  },
  { name: 'src', path: 'src', type: 'tree', mode: '040000', hash: 'bbbb2222' },
  {
    name: 'worker',
    path: 'worker',
    type: 'tree',
    mode: '040000',
    hash: 'cccc3333',
  },
  {
    name: 'DESIGN.md',
    path: 'DESIGN.md',
    type: 'blob',
    mode: '100644',
    hash: 'dddd4444',
  },
  {
    name: 'package.json',
    path: 'package.json',
    type: 'blob',
    mode: '100644',
    hash: 'eeee5555',
  },
  {
    name: 'README.md',
    path: 'README.md',
    type: 'blob',
    mode: '100644',
    hash: 'ffff6666',
  },
  {
    name: 'wrangler-edge-runtime-protocol-adapter-cloudflare-workers-v2-configuration.jsonc',
    path: 'wrangler-edge-runtime-protocol-adapter-cloudflare-workers-v2-configuration.jsonc',
    type: 'blob',
    mode: '100644',
    hash: '99990000',
  },
];

const SUBTREE_ENTRIES = [
  {
    name: 'code',
    path: 'src/components/code',
    type: 'tree',
    mode: '040000',
    hash: '1234aaaa',
  },
  {
    name: 'shell',
    path: 'src/components/shell',
    type: 'tree',
    mode: '040000',
    hash: '2345bbbb',
  },
  {
    name: 'ui',
    path: 'src/components/ui',
    type: 'tree',
    mode: '040000',
    hash: '3456cccc',
  },
  {
    name: 'CommitList.tsx',
    path: 'src/components/CommitList.tsx',
    type: 'blob',
    mode: '100644',
    hash: '4567dddd',
  },
  {
    name: 'DiffView.tsx',
    path: 'src/components/DiffView.tsx',
    type: 'blob',
    mode: '100644',
    hash: '5678eeee',
  },
  {
    name: 'RepoLayout.tsx',
    path: 'src/components/RepoLayout.tsx',
    type: 'blob',
    mode: '100644',
    hash: '6789ffff',
  },
  {
    name: 'VirtualizedUnifiedAndSplitDiffSyntaxHighlightedViewportContainer.tsx',
    path: 'src/components/VirtualizedUnifiedAndSplitDiffSyntaxHighlightedViewportContainer.tsx',
    type: 'blob',
    mode: '100644',
    hash: '7890aaaa',
  },
];

const BLOB_SOURCE_TEXT = [
  '// Modified by CyberNova for the CloudForge fork (forked 2026-10-22).',
  "import type { ArtifactNamespace } from './types';",
  '',
  'export interface RefUpdateReceipt {',
  '  readonly repoId: string;',
  '  readonly ref: string;',
  '  readonly oldOid: string;',
  '  readonly newOid: string;',
  '  readonly updatedAt: number;',
  '}',
  '',
  'export async function resolveBranchHead(',
  '  artifacts: ArtifactNamespace,',
  '  repoId: string,',
  '  branch: string',
  '): Promise<string | null> {',
  '  const refName = `refs/heads/${branch}`;',
  '  const target = await artifacts.getRef(repoId, refName);',
  '  return target ? target.oid : null;',
  '}',
].join('\n');

const DIFF_FILES = [
  {
    path: 'src/git/service.ts',
    status: 'modified',
    oldHash: '2222222',
    newHash: '1111111',
    mode: '100644',
    additions: 8,
    deletions: 3,
    binary: false,
    tooLarge: false,
    hunks: [
      {
        oldStart: 10,
        oldLines: 9,
        newStart: 10,
        newLines: 14,
        lines: [
          ' export async function resolveBranchHead(',
          '   artifacts: ArtifactNamespace,',
          '   repoId: string,',
          '   branch: string',
          ' ): Promise<string | null> {',
          '-  const target = await artifacts.resolve(repoId, branch);',
          '-  if (!target) return null;',
          '-  return target.oid;',
          '+  if (!branch || branch.includes("..")) {',
          '+    throw new Error("Invalid branch reference name");',
          '+  }',
          '+  const refName = `refs/heads/${branch}`;',
          '+  const target = await artifacts.getRef(repoId, refName);',
          '+  if (!target) {',
          '+    return null;',
          '+  }',
          '+  return target.oid;',
          ' }',
        ],
      },
    ],
  },
  {
    path: 'src/styles/primer-tokens.ts',
    status: 'added',
    oldHash: null,
    newHash: '3333333',
    mode: '100644',
    additions: 5,
    deletions: 0,
    binary: false,
    tooLarge: false,
    hunks: [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 5,
        lines: [
          '+export const PRIMER_LIGHT_ACCENT = "#0969da";',
          '+export const PRIMER_DARK_ACCENT = "#2f81f7";',
          '+export const PRIMER_BORDER_DEFAULT = "#d0d7de";',
          '+export const PRIMER_BODY_FONT_SIZE = "14px";',
          '+export const PRIMER_BOX_RADIUS = "6px";',
        ],
      },
    ],
  },
];

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/auth/get-session') {
    return sendJson(res, 200, {
      session: {
        id: 'sess-visual-baseline',
        userId: USER_ADA.id,
        expiresAt: '2027-12-31T23:59:59.000Z',
      },
      user: {
        ...USER_ADA,
        email: 'ada@cloudforge.dev',
        displayUsername: 'ada',
        role: 'admin',
        twoFactorEnabled: true,
      },
    });
  }
  if (p === '/api/setup') {
    return sendJson(res, 200, {
      setupRequired: false,
      initialized: true,
      appName: 'CloudForge',
    });
  }
  if (p === '/api/me/preferences') {
    return sendJson(res, 200, { language: 'en' });
  }
  if (p === '/api/me/authentication-policy') {
    return sendJson(res, 200, {
      sessionId: 'sess-visual-baseline',
      policy: { version: 1, requireMfa: false },
      access: 'full',
      enrolled: true,
    });
  }
  if (p === '/api/notifications/count') {
    return sendJson(res, 200, { unread: 2 });
  }
  if (p === '/api/approvals') {
    return sendJson(res, 200, {
      items: [],
      nextCursor: null,
      count: 0,
      total: 0,
    });
  }
  if (p === '/api/admin/setup') {
    return sendJson(res, 200, {
      checks: [],
      counts: { ok: 5, warning: 0, error: 0 },
      checkedAt: '2026-10-31T12:00:00.000Z',
    });
  }
  if (p === '/api/agents') {
    return sendJson(res, 200, []);
  }
  if (p === '/api/repos') {
    return sendJson(res, 200, [REPO_CLOUDFORGE, REPO_EMPTY]);
  }
  if (p === '/api/repos/acme/cloudforge') {
    return sendJson(res, 200, REPO_CLOUDFORGE);
  }
  if (p === '/api/repos/acme/empty-repo') {
    return sendJson(res, 200, REPO_EMPTY);
  }
  if (p.endsWith('/watch')) {
    return sendJson(res, 200, { level: 'participating', watchers: 14 });
  }
  if (p.endsWith('/agents')) {
    return sendJson(res, 200, [
      {
        id: 'agent-sentinel',
        username: 'sentinel',
        name: 'Sentinel Security',
        image: null,
        bio: 'Automated security and access-control reviewer',
        reviewLanguage: 'en',
        trigger: { ask: 'always', above: 0 },
        engine: 'pi',
        color: '#0969da',
        facet: 'security',
        guarded: true,
        repository: 'sentinel/sentinel',
        configSha: COMMIT_1_SHA,
        configError: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        deletedAt: null,
        invitedAt: '2026-10-02T00:00:00.000Z',
      },
    ]);
  }
  if (p === '/api/repos/acme/empty-repo/contents') {
    return sendJson(res, 200, {
      ref: 'main',
      path: '',
      commitSha: null,
      latestCommit: null,
      kind: 'empty',
    });
  }
  if (p === '/api/repos/acme/cloudforge/contents') {
    const refPath = url.searchParams.get('refPath') || '';
    if (refPath === '' || refPath === 'main') {
      return sendJson(res, 200, {
        ref: 'main',
        path: '',
        commitSha: COMMIT_1_SHA,
        latestCommit: COMMITS[0],
        kind: 'tree',
        entries: ROOT_ENTRIES,
        readme: {
          path: 'README.md',
          text: '# CloudForge\n\nHigh-density Git Smart HTTP v2 hosting built on **Cloudflare Workers**, Durable Objects, D1, and R2.\n\n## Core Capabilities\n\n- **Atomic Ref Transactions**: CAS fast-forward updates backed by D1 and Artifacts.\n- **Primer Design System**: 14px typographic anchor, functional color tokens, and WCAG AA contrast.\n- **Stacked Pull Requests**: Automated rebase landing and guarded AI code review.\n',
        },
      });
    }
    if (refPath === 'main/src/components') {
      return sendJson(res, 200, {
        ref: 'main',
        path: 'src/components',
        commitSha: COMMIT_1_SHA,
        latestCommit: COMMITS[1],
        kind: 'tree',
        entries: SUBTREE_ENTRIES,
        readme: null,
      });
    }
    if (refPath === 'main/src/git/service.ts') {
      return sendJson(res, 200, {
        ref: 'main',
        path: 'src/git/service.ts',
        commitSha: COMMIT_1_SHA,
        latestCommit: COMMITS[0],
        kind: 'blob',
        file: {
          path: 'src/git/service.ts',
          size: Buffer.byteLength(BLOB_SOURCE_TEXT, 'utf8'),
          binary: false,
          tooLarge: false,
          text: BLOB_SOURCE_TEXT,
          lfs: null,
        },
      });
    }
  }
  if (p === '/api/repos/acme/cloudforge/tree-commits') {
    const subPath = url.searchParams.get('path') || '';
    const entries =
      subPath === 'src/components' ? SUBTREE_ENTRIES : ROOT_ENTRIES;
    const map = {};
    entries.forEach((e, idx) => {
      map[e.name] = COMMITS[idx % COMMITS.length];
    });
    return sendJson(res, 200, map);
  }
  if (p === '/api/repos/acme/cloudforge/commits') {
    return sendJson(res, 200, {
      commits: COMMITS,
      hasMore: false,
    });
  }
  if (p === '/api/repos/acme/cloudforge/commit-statuses') {
    return sendJson(res, 200, {
      [COMMIT_1_SHA]: { state: 'success', runs: [], statuses: [] },
      [COMMIT_2_SHA]: { state: 'success', runs: [], statuses: [] },
      [COMMIT_3_SHA]: { state: 'pending', runs: [], statuses: [] },
      [COMMIT_4_SHA]: { state: 'success', runs: [], statuses: [] },
    });
  }
  if (
    p.startsWith('/api/repos/acme/cloudforge/commits/') &&
    p.endsWith('/runs')
  ) {
    return sendJson(res, 200, { state: 'success', runs: [], statuses: [] });
  }
  if (p.startsWith('/api/repos/acme/cloudforge/commit/')) {
    return sendJson(res, 200, {
      commit: COMMITS[0],
      files: DIFF_FILES,
    });
  }
  if (p.endsWith('/live')) {
    return sendJson(res, 200, { rev: '1' });
  }

  return sendJson(res, 200, {});
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`
  );

  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url);
  }

  let filePath = path.join(CLIENT_DIR, decodeURIComponent(url.pathname));
  if (
    url.pathname === '/' ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    filePath = path.join(CLIENT_DIR, 'index.html');
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Static asset error: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CloudForge visual server listening on http://${HOST}:${PORT}`);
});
