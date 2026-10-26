// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { ArtifactsRepoClient } from '../git/remote';
import { GitService } from '../git/service';
import { decoder } from '../git/bytes';
import { createFakeArtifacts } from './helpers/fake-artifacts';
import { commitFiles } from './helpers/seed';

const LINES = (n: number, tag = '') =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}${tag}`).join('\n') + '\n';

/** A repo with `base` on main, then `ours` on main and `theirs` on feature, both from base. */
async function diverged(
  base: Record<string, string>,
  ours: Record<string, string>,
  theirs: Record<string, string>
) {
  const fake = createFakeArtifacts();
  await fake.binding.create('r');
  const repo = fake.repos.get('r')!;
  const root = await commitFiles(repo, 'main', base, 'base');
  const oursSha = await commitFiles(repo, 'main', ours, 'ours');
  const theirsSha = await commitFiles(repo, 'feature', theirs, 'theirs', [
    root,
  ]);
  const git = new GitService(new ArtifactsRepoClient(fake.binding, 'r'));
  /** Planned objects only exist in memory until pushed; store them so they can be read. */
  const keep = (plan: { objects?: Parameters<typeof repo.add> }) =>
    repo.add(...(plan.objects ?? []));
  return { git, repo, oursSha, theirsSha, keep };
}

async function fileAt(git: GitService, tree: string, name: string) {
  const entry = (await git.tree(tree)).find((e) => e.name === name);
  return entry ? decoder.decode((await git.blob(entry.hash))!) : null;
}

describe('行级合并', () => {
  it('合并 40 位名称分支时读取两边真正的头并对目标头作 CAS', async () => {
    const { git, repo, oursSha, theirsSha } = await diverged(
      { 'a.txt': 'base\n' },
      { 'a.txt': 'base\n', 'ours.txt': 'ours\n' },
      { 'a.txt': 'base\n', 'theirs.txt': 'theirs\n' }
    );
    const base = repo.parseCommit(oursSha)!.parents[0];
    const head = oursSha;
    repo.refs.set(`refs/heads/${base}`, oursSha);
    repo.refs.set(`refs/heads/${head}`, theirsSha);
    const merged = await git.merge({
      base,
      head,
      method: 'merge',
      message: 'Merge named branches',
      author: {
        name: 'Dev',
        email: 'dev@example.com',
        timestamp: 1_700_000_000,
      },
    });
    expect(merged.headSha).toBe(theirsSha);
    expect(repo.parseCommit(merged.sha)!.parents).toEqual([oursSha, theirsSha]);
    expect(repo.refs.get(`refs/heads/${base}`)).toBe(merged.sha);
  });

  it('合并同一文件不同部分的编辑', async () => {
    const base = LINES(20);
    const ours = base.replace('line 2\n', 'line 2 (ours)\n');
    const theirs = base.replace('line 18\n', 'line 18 (theirs)\n');
    const { git, oursSha, theirsSha, keep } = await diverged(
      { 'a.txt': base },
      { 'a.txt': ours },
      { 'a.txt': theirs }
    );
    const plan = await git.planMerge(oursSha, theirsSha);
    if (plan.upToDate) throw new Error('出现意外的合并结果');
    keep(plan);
    expect(plan.conflicts).toEqual([]);
    const merged = await fileAt(git, plan.tree, 'a.txt');
    expect(merged).toContain('line 2 (ours)');
    expect(merged).toContain('line 18 (theirs)');
  });

  it('使用 diff3 标记及双方内容报告重叠编辑', async () => {
    const base = LINES(5);
    const { git, oursSha, theirsSha, keep } = await diverged(
      { 'a.txt': base, 'b.txt': 'same\n' },
      { 'a.txt': base.replace('line 3', 'line 3 ours'), 'b.txt': 'same\n' },
      { 'a.txt': base.replace('line 3', 'line 3 theirs'), 'b.txt': 'same\n' }
    );
    const plan = await git.planMerge(oursSha, theirsSha, {
      collectConflictFiles: true,
      labels: { a: 'main', o: 'base', b: 'feature' },
    });
    if (plan.upToDate) throw new Error('出现意外的合并结果');
    keep(plan);
    expect(plan.conflicts).toEqual(['a.txt']);
    expect(plan.conflictFiles).toHaveLength(1);
    const file = plan.conflictFiles[0];
    expect(file).toMatchObject({ path: 'a.txt', base });
    expect(file.withMarkers).toContain('<<<<<<< main');
    expect(file.withMarkers).toContain('||||||| base');
    expect(file.withMarkers).toContain('>>>>>>> feature');
    expect(file.withMarkers).toContain('line 3 ours');
    expect(file.withMarkers).toContain('line 3 theirs');
    // Untouched files still merge.
    expect(await fileAt(git, plan.tree, 'b.txt')).toBe('same\n');
  });

  it('为冲突路径应用提供的解决结果', async () => {
    const base = LINES(3);
    const { git, oursSha, theirsSha, keep } = await diverged(
      { 'a.txt': base },
      { 'a.txt': 'ours\n' },
      { 'a.txt': 'theirs\n' }
    );
    const plan = await git.planMerge(oursSha, theirsSha, {
      resolutions: new Map([['a.txt', 'resolved\n']]),
    });
    if (plan.upToDate) throw new Error('出现意外的合并结果');
    keep(plan);
    expect(plan.conflicts).toEqual([]);
    expect(await fileAt(git, plan.tree, 'a.txt')).toBe('resolved\n');
  });

  it('将二进制文件和删除与修改冲突保留为冲突', async () => {
    const { git, oursSha, theirsSha, keep } = await diverged(
      { 'img.bin': 'a\u0000b', 'gone.txt': 'x\n' },
      { 'img.bin': 'a\u0000c', 'gone.txt': 'x changed\n' },
      { 'img.bin': 'a\u0000d' }
    );
    // theirs (feature) only kept img.bin, so it deleted gone.txt
    const plan = await git.planMerge(oursSha, theirsSha, {
      collectConflictFiles: true,
    });
    if (plan.upToDate) throw new Error('出现意外的合并结果');
    keep(plan);
    expect(plan.conflicts.sort()).toEqual(['gone.txt', 'img.bin']);
    expect(plan.conflictFiles).toEqual([]);
  });

  it('双方以不同内容新增同一文件时，仅在逐行一致的情况下合并', async () => {
    const { git, oursSha, theirsSha, keep } = await diverged(
      { 'keep.txt': 'k\n' },
      { 'keep.txt': 'k\n', 'new.txt': 'one\n' },
      { 'keep.txt': 'k\n', 'new.txt': 'two\n' }
    );
    const plan = await git.planMerge(oursSha, theirsSha, {
      collectConflictFiles: true,
    });
    if (plan.upToDate) throw new Error('出现意外的合并结果');
    keep(plan);
    expect(plan.conflicts).toEqual(['new.txt']);
    expect(plan.conflictFiles[0].base).toBeNull();
  });
});

describe('残留冲突标记', () => {
  it('找出标记行及其位置，并忽略相似内容', async () => {
    const { markerLines } = await import('../merge/resolver');
    expect(
      markerLines({
        'a.py': 'ok\n<<<<<<< main\nx\n=======\ny\n>>>>>>> feature\n',
        'b.md':
          '======= heading underline is not a marker? it is: 7 then space\n',
        'c.txt': '<<<<<<<< eight is not a marker\nclean\n',
      })
    ).toEqual([
      { path: 'a.py', line: 2, text: '<<<<<<< main' },
      { path: 'a.py', line: 4, text: '=======' },
      { path: 'a.py', line: 6, text: '>>>>>>> feature' },
      {
        path: 'b.md',
        line: 1,
        text: '======= heading underline is not a marker? it is: 7 then space',
      },
    ]);
  });
});
