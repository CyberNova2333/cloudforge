// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { gitForName } from '../lib/repos';
import {
  CHECKOUT_LIMITS,
  checkoutHead,
  MAX_SKIPPED_LISTED,
  notCheckedOutText,
  type Checkout,
} from '../review/checkout';
import { ignoreMatcher } from '../review/ignore';
import { appRepo } from './helpers/reviews';
import { makeBlob, makeCommit, makeTree } from '../git/objects';
import { commitPaths } from './helpers/seed';

async function headWith(files: Record<string, string>) {
  const { t, repo } = await appRepo();
  const sha = await commitPaths(repo, 'main', files, 'Files');
  const name = [...t.fake.repos.keys()][0];
  return { git: gitForName(t.env, name), sha };
}

async function checkout(
  files: Record<string, string>,
  opts: Partial<Parameters<typeof checkoutHead>[2]> = {}
) {
  const { git, sha } = await headWith(files);
  const written = new Map<string, string>();
  const order: string[] = [];
  const result = await checkoutHead(
    git,
    sha,
    { first: [], ignored: ignoreMatcher(null), ...opts },
    async (path, text) => {
      written.set(path, text);
      order.push(path);
    }
  );
  return { result, written, order };
}

describe('checkoutHead 检出头提交', () => {
  it('按仓库路径写入每个文本文件，优先写入变更文件', async () => {
    const { result, written, order } = await checkout(
      {
        'README.md': '# app\n',
        'src/a.ts': 'export const a = 1;\n',
        'src/b.ts': 'export const b = 2;\n',
      },
      { first: ['src/b.ts'] }
    );
    expect(order).toEqual(['src/b.ts', 'README.md', 'src/a.ts']);
    expect(written.get('src/a.ts')).toBe('export const a = 1;\n');
    expect(result).toMatchObject({ files: 3, skipped: [], truncated: false });
    expect(result.bytes).toBe(
      '# app\n'.length + 2 * 'export const a = 1;\n'.length
    );
  });

  it('跳过并列出二进制、被忽略、过大及超预算文件', async () => {
    const { result, written } = await checkout(
      {
        'yarn.lock': 'lock\n',
        'gen/schema.ts': 'generated\n',
        'logo.png': 'PNG\u0000\u0001',
        'big.txt': 'x'.repeat(2048),
        'src/a.ts': 'a\n',
        'src/b.ts': 'b\n',
        'src/c.ts': 'c\n',
      },
      {
        first: ['src/c.ts'],
        ignored: ignoreMatcher('gen/\n'),
        limits: { fileBytes: 1024, files: 2 },
      }
    );
    // src/c.ts first (it changed), then path order: big.txt too large, gen/schema.ts ignored, logo.png binary,
    // src/a.ts the second and last file the budget allows, src/b.ts over budget, yarn.lock a lockfile.
    expect([...written.keys()]).toEqual(['src/c.ts', 'src/a.ts']);
    expect(result.files).toBe(2);
    expect(
      Object.fromEntries(result.skipped.map((s) => [s.path, s.reason]))
    ).toEqual({
      'big.txt': 'too large',
      'gen/schema.ts': 'ignored',
      'logo.png': 'binary',
      'src/b.ts': 'over budget',
      'yarn.lock': 'ignored',
    });
  });

  it('达到读取上限时停止读取 blob，即使已读内容均未写入', async () => {
    const { result, written } = await checkout(
      {
        'a.bin': 'A\u0000',
        'b.bin': 'B\u0000',
        'c.txt': 'c\n',
        'd.txt': 'd\n',
      },
      { limits: { reads: 3 } }
    );
    // Three reads: two binaries (skipped after reading) and c.txt; d.txt is never read.
    expect([...written.keys()]).toEqual(['c.txt']);
    expect(
      Object.fromEntries(result.skipped.map((s) => [s.path, s.reason]))
    ).toEqual({
      'a.bin': 'binary',
      'b.bin': 'binary',
      'd.txt': 'over budget',
    });
  });

  it('达到文件数量上限时停止遍历并说明原因', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++)
      files[`f${String(i).padStart(2, '0')}.txt`] = `${i}\n`;
    const { result, written } = await checkout(files, { limits: { walk: 5 } });
    expect(written.size).toBe(5);
    expect(result.truncated).toBe(true);
    expect(notCheckedOutText(result)).toContain(
      '…and more: the tree has more than 5 files'
    );
  });

  it('拒绝无法读取的提交', async () => {
    const { git } = await headWith({ 'a.txt': 'a\n' });
    await expect(
      checkoutHead(
        git,
        'f'.repeat(40),
        { first: [], ignored: () => false },
        async () => {}
      )
    ).rejects.toThrow('could not be read');
  });
});

describe('notCheckedOutText 未检出内容提示', () => {
  it('没有遗漏时说明所有内容均已检出', () => {
    expect(
      notCheckedOutText({ files: 3, bytes: 10, skipped: [], truncated: false })
    ).toBe('Every file of the head commit is checked out under /repo.\n');
  });

  it(`列出未检出内容及原因，最多 ${MAX_SKIPPED_LISTED} 行`, () => {
    const c: Checkout = {
      files: 1,
      bytes: 1,
      truncated: false,
      skipped: Array.from({ length: MAX_SKIPPED_LISTED + 2 }, (_, i) => ({
        path: `bin/${i}.png`,
        reason: 'binary' as const,
      })),
    };
    const text = notCheckedOutText(c);
    expect(text.split('\n')[0]).toBe(
      `Not checked out under /repo (${MAX_SKIPPED_LISTED + 2} files):`
    );
    expect(text).toContain('bin/0.png: binary');
    expect(text).toContain('…and 2 more');
    expect(text).not.toContain(`bin/${MAX_SKIPPED_LISTED}.png`);
  });
});

describe('checkoutHead 检出安全性', () => {
  it('不写入符号链接或子模块，并跳过格式错误的名称', async () => {
    const { t, repo } = await appRepo();
    const blob = await makeBlob('ok\n');
    const link = await makeBlob('../../etc');
    const link2 = await makeBlob('/review');
    repo.add(blob, link, link2);
    const tree = await makeTree([
      { name: '..', mode: '100644', hash: blob.sha },
      { name: 'escape', mode: '120000', hash: link.sha },
      { name: 'review', mode: '120000', hash: link2.sha },
      { name: 'ok.txt', mode: '100644', hash: blob.sha },
      { name: 'vendor', mode: '160000', hash: blob.sha },
    ]);
    repo.add(tree);
    const commit = await makeCommit({
      tree: tree.sha,
      parents: [],
      author: {
        name: 'Dev',
        email: 'dev@example.com',
        timestamp: 1_700_000_000,
      },
      message: 'Links',
    });
    repo.add(commit);
    const name = [...t.fake.repos.keys()][0];
    const written = new Map<string, string>();
    const result = await checkoutHead(
      gitForName(t.env, name),
      commit.sha,
      { first: [], ignored: () => false },
      async (path, text) => void written.set(path, text)
    );
    expect([...written.keys()]).toEqual(['ok.txt']);
    expect(
      Object.fromEntries(result.skipped.map((s) => [s.path, s.reason]))
    ).toEqual({
      escape: 'symlink',
      review: 'symlink',
      vendor: 'submodule',
      '..': 'bad name',
    });
    expect(notCheckedOutText(result)).toContain('escape: symlink');
  });
});

describe('checkoutHead 检出边界', () => {
  it('达到深度上限后不再向下遍历', async () => {
    const { result, written } = await checkout(
      { 'a/b/c/d/e/deep.txt': 'x\n', 'top.txt': 't\n' },
      { limits: { depth: 3 } }
    );
    expect([...written.keys()]).toEqual(['top.txt']);
    expect(result.truncated).toBe(true);
  });

  it('耗尽树读取预算后停止，无论目录多小', async () => {
    const { t, repo } = await appRepo();
    const blob = await makeBlob('x\n');
    repo.add(blob);
    const dirs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        makeTree([{ name: `f${i}.txt`, mode: '100644', hash: blob.sha }])
      )
    );
    repo.add(...dirs);
    const tree = await makeTree(
      dirs.map((d, i) => ({
        name: `d${String(i).padStart(2, '0')}`,
        mode: '40000',
        hash: d.sha,
      }))
    );
    repo.add(tree);
    const commit = await makeCommit({
      tree: tree.sha,
      parents: [],
      author: {
        name: 'Dev',
        email: 'dev@example.com',
        timestamp: 1_700_000_000,
      },
      message: 'Dirs',
    });
    repo.add(commit);
    const git = gitForName(t.env, [...t.fake.repos.keys()][0]);
    const result = await checkoutHead(
      git,
      commit.sha,
      { first: [], ignored: () => false, limits: { trees: 5 } },
      async () => {}
    );
    expect(result.truncated).toBe(true);
  });

  it('将格式错误的名称计入遍历数量', async () => {
    const { t, repo } = await appRepo();
    const blob = await makeBlob('x\n');
    repo.add(blob);
    const tree = await makeTree(
      Array.from({ length: 12 }, (_, i) => ({
        name: `x/${i}`,
        mode: '100644',
        hash: blob.sha,
      }))
    );
    repo.add(tree);
    const commit = await makeCommit({
      tree: tree.sha,
      parents: [],
      author: {
        name: 'Dev',
        email: 'dev@example.com',
        timestamp: 1_700_000_000,
      },
      message: 'Bad',
    });
    repo.add(commit);
    const git = gitForName(t.env, [...t.fake.repos.keys()][0]);
    const result = await checkoutHead(
      git,
      commit.sha,
      { first: [], ignored: () => false, limits: { walk: 5 } },
      async () => {}
    );
    expect(result.truncated).toBe(true);
    expect(result.skipped.length).toBeLessThanOrEqual(5);
    expect(result.skipped.every((s) => s.reason === 'bad name')).toBe(true);
  });

  it('即使遍历提前停止，也检出变更文件', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++)
      files[`f${String(i).padStart(2, '0')}.txt`] = `${i}\n`;
    files['z/deep/changed.ts'] = 'changed\n';
    const { result, written, order } = await checkout(files, {
      first: ['z/deep/changed.ts'],
      limits: { walk: 5 },
    });
    expect(order[0]).toBe('z/deep/changed.ts');
    expect(written.get('z/deep/changed.ts')).toBe('changed\n');
    expect(result.truncated).toBe(true);
  });

  it('跳过并列出 .git 条目', async () => {
    const { result, written } = await checkout({
      '.git/config': 'x\n',
      'sub/.git/HEAD': 'y\n',
      'ok.txt': 'ok\n',
    });
    expect([...written.keys()]).toEqual(['ok.txt']);
    expect(result.skipped.map((s) => s.path).sort()).toEqual([
      '.git',
      'sub/.git',
    ]);
  });
});

describe('CHECKOUT_LIMITS 检出限额', () => {
  it('单次检出的 Artifacts 调用数保持在数千次以内，包含树与 blob 读取', () => {
    expect(CHECKOUT_LIMITS.trees).toBe(1000);
    expect(CHECKOUT_LIMITS.reads).toBe(2000);
    expect(CHECKOUT_LIMITS.trees + CHECKOUT_LIMITS.reads).toBeLessThanOrEqual(
      3000
    );
  });
});

describe('checkoutHead 检出变更文件', () => {
  it('在默认树读取预算内检出嵌套目录中的约 300 个变更文件', async () => {
    const files: Record<string, string> = {};
    const changed: string[] = [];
    for (let i = 0; i < 300; i++) {
      // Depth 5–8: pkgN/src/lib/mod/[x/[y/[z/]]]fNNN.ts
      const extra = ['', 'x/', 'x/y/', 'x/y/z/'][i % 4];
      const path = `pkg${i % 6}/src/lib/mod${i % 5}/${extra}f${i}.ts`;
      files[path] = `export const v${i} = ${i};\n`;
      changed.push(path);
    }
    const { result, written } = await checkout(files, { first: changed });
    for (const path of changed) expect(written.has(path)).toBe(true);
    expect(result.files).toBe(300);
    expect(result.skipped).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('将树读取预算内无法访问的变更文件列为超预算，且仍继续遍历', async () => {
    const { result, written } = await checkout(
      {
        'top.txt': 't\n',
        'a/b/c/one.ts': '1\n',
        'd/e/f/two.ts': '2\n',
      },
      { first: ['a/b/c/one.ts', 'd/e/f/two.ts'], limits: { trees: 4 } }
    );
    // one.ts costs four reads (root, a, a/b, a/b/c): two.ts is never reached.
    expect(written.get('a/b/c/one.ts')).toBe('1\n');
    expect(written.has('d/e/f/two.ts')).toBe(false);
    expect(result.skipped).toContainEqual({
      path: 'd/e/f/two.ts',
      reason: 'over budget',
    });
    // The walk reuses the root it already read: top.txt is checked out.
    expect(written.get('top.txt')).toBe('t\n');
    expect(result.truncated).toBe(true);
    expect(notCheckedOutText(result)).toContain('d/e/f/two.ts: over budget');
  });
});
