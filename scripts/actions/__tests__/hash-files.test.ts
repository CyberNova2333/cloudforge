// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HASH_FILES_SCRIPT } from '../../../worker/src/actions/hash-files';

// This is the actual Node program run by the Linux job container, not a reimplementation of its glob matcher.
let root: string;
let workspace: string;
const contents = {
  'abc.txt': 'abc',
  'package-lock.json': '{"lockfileVersion":3}',
  'a/package-lock.json': 'a',
  'a/b/package-lock.json': 'ab',
  'a/b/notes.txt': 'notes',
  '.config/tool.json': 'dot',
  'node_modules/x/package-lock.json': 'dep',
  'src/one.ts': '1',
  'src/two.ts': '2',
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cf-hash-files-'));
  workspace = join(root, 'workspace');
  for (const [file, text] of Object.entries(contents)) {
    mkdirSync(dirname(join(workspace, file)), { recursive: true });
    writeFileSync(join(workspace, file), text);
  }
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'outside', 'secret.txt'), 'outside workspace');
});

afterAll(() => {
  const target = resolve(root);
  // Only the unique fixture created above can be removed; no shared worktree path is involved.
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith('cf-hash-files-')
  )
    throw new Error('Unexpected hashFiles fixture cleanup path.');
  rmSync(target, { recursive: true, force: true });
});

function runRaw(raw: string, follow = false, guardOutside = false): string {
  const guard = guardOutside
    ? String.raw`
const trackedFs = require('fs');
const trackedPath = require('path');
const outsidePath = process.env.HASH_TEST_OUTSIDE;
let outsideVisits = 0;
for (const method of ['statSync', 'lstatSync', 'realpathSync', 'readdirSync', 'openSync']) {
  const original = trackedFs[method];
  trackedFs[method] = function (p, ...args) {
    if (typeof p === 'string') {
      const absolute = trackedPath.resolve(p);
      if (absolute === outsidePath || absolute.startsWith(outsidePath + '/')) {
        outsideVisits++;
        throw new Error('Attempted to visit outside workspace: ' + method);
      }
    }
    return original.call(this, p, ...args);
  };
}
`
    : '';
  const checked =
    guard +
    HASH_FILES_SCRIPT +
    (guardOutside
      ? '\nif (outsideVisits) throw new Error("Visited outside workspace.");'
      : '');
  return execFileSync(process.execPath, ['-e', checked], {
    cwd: workspace,
    env: {
      ...process.env,
      HASH_PATTERNS: raw,
      HASH_FOLLOW: follow ? '1' : '',
      HASH_TEST_OUTSIDE: join(root, 'outside'),
    },
    timeout: 4_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

const hashFiles = (patterns: string[], follow = false, guardOutside = false) =>
  runRaw(JSON.stringify(patterns), follow, guardOutside);

function expected(paths: string[]) {
  const total = createHash('sha256');
  for (const file of [...paths].sort())
    total.update(
      createHash('sha256')
        .update(readFileSync(join(workspace, file)))
        .digest()
    );
  return total.digest('hex');
}

describe('hashFiles JSON 输入边界', () => {
  it('无效 JSON 与非数组参数失败，不当作代码求值', () => {
    expect(() => runRaw('{')).toThrow();
    expect(() => runRaw('null')).toThrow();
  });
});

describe.runIf(process.platform !== 'win32')('hashFiles Linux 容器程序', () => {
  it('单文件摘要与已知 double-SHA256 常量一致', () => {
    expect(hashFiles(['abc.txt'])).toBe(
      '4f8b42c22dd3729b519ba6f68d2da7cc5b2d606d05daed5ad5128cc03e6c6358'
    );
  });

  it('**、点目录、否定模式和后续重新包含按顺序匹配', () => {
    expect(hashFiles(['**/package-lock.json', '!node_modules/**'])).toBe(
      expected([
        'package-lock.json',
        'a/package-lock.json',
        'a/b/package-lock.json',
      ])
    );
    expect(hashFiles(['**/package-lock.json\n!**/node_modules/**'])).toBe(
      expected([
        'package-lock.json',
        'a/package-lock.json',
        'a/b/package-lock.json',
      ])
    );
    expect(
      hashFiles(['**/package-lock.json', '!a/**', 'a/b/package-lock.json'])
    ).toBe(
      expected([
        'package-lock.json',
        'a/b/package-lock.json',
        'node_modules/x/package-lock.json',
      ])
    );
    expect(hashFiles(['**/tool.json'])).toBe(expected(['.config/tool.json']));
  });

  it('匹配目录含后代，支持工作区内绝对路径及字符集', () => {
    expect(hashFiles(['src'])).toBe(expected(['src/one.ts', 'src/two.ts']));
    expect(hashFiles([`${workspace}/src/*.ts`])).toBe(
      expected(['src/one.ts', 'src/two.ts'])
    );
    expect(hashFiles(['src/[o]ne.ts'])).toBe(expected(['src/one.ts']));
    expect(hashFiles(['src/', 'a/b/'])).toBe(
      expected([
        'src/one.ts',
        'src/two.ts',
        'a/b/package-lock.json',
        'a/b/notes.txt',
      ])
    );
  });

  it('没有匹配返回空串，重复和重叠模式不重复计入文件', () => {
    expect(hashFiles(['**/nothing.here'])).toBe('');
    expect(hashFiles(['src', 'src/*.ts', 'src/one.ts', 'src'])).toBe(
      expected(['src/one.ts', 'src/two.ts'])
    );
  });

  it('内部文件链接可读取，内部目录链接只有明确 follow 才遍历', () => {
    symlinkSync(join(workspace, 'abc.txt'), join(workspace, 'internal-file'));
    symlinkSync(join(workspace, 'src'), join(workspace, 'internal-dir'), 'dir');
    expect(hashFiles(['internal-file'])).toBe(expected(['abc.txt']));
    expect(hashFiles(['internal-dir/**'])).toBe('');
    expect(hashFiles(['internal-dir/**'], true)).toBe(
      expected(['internal-dir/one.ts', 'internal-dir/two.ts'])
    );
  });

  it('较早的宽模式扫描不应吞掉稍后的内部目录别名匹配', () => {
    symlinkSync(join(workspace, 'a'), join(workspace, 'later-alias'), 'dir');
    expect(hashFiles(['**/nothing.here', 'later-alias/**'], true)).toBe(
      expected([
        'later-alias/b/notes.txt',
        'later-alias/b/package-lock.json',
        'later-alias/package-lock.json',
      ])
    );
  });

  it('外部文件和目录链接在两种 follow 模式下均不读取内容', () => {
    symlinkSync(
      join(root, 'outside', 'secret.txt'),
      join(workspace, 'external-file')
    );
    symlinkSync(join(root, 'outside'), join(workspace, 'external-dir'), 'dir');
    for (const follow of [false, true]) {
      expect(hashFiles(['external-file'], follow)).toBe('');
      expect(hashFiles(['external-dir/**'], follow)).toBe('');
    }
  });

  it('目录链接循环终止，FIFO 等非普通文件不打开', () => {
    mkdirSync(join(workspace, 'cycle'));
    writeFileSync(join(workspace, 'cycle', 'regular.txt'), 'regular');
    symlinkSync(
      join(workspace, 'cycle'),
      join(workspace, 'cycle', 'again'),
      'dir'
    );
    execFileSync('mkfifo', [join(workspace, 'cycle', 'named-pipe')]);
    expect(hashFiles(['cycle/**'], true)).toBe(expected(['cycle/regular.txt']));
  });

  it('模式里的 shell 元字符仅作为文件名处理，不执行命令', () => {
    const file = "literal-$(touch HASH_EXECUTED);quoted'.json";
    writeFileSync(join(workspace, file), 'literal');
    expect(hashFiles([file])).toBe(expected([file]));
    expect(existsSync(join(workspace, 'HASH_EXECUTED'))).toBe(false);
  });

  it('工作区外的绝对或相对模式既不遍历也不返回内容', () => {
    expect(hashFiles([`${root}/outside/**`], true, true)).toBe('');
    expect(hashFiles(['../outside/secret.txt'], false, true)).toBe('');
  });
});
