import { describe, expect, it } from 'vitest';
import { ArtifactsRepoClient } from '../../git/remote';
import { GitService } from '../../git/service';
import { createFakeArtifacts } from '../helpers/fake-artifacts';
import { commitFiles } from '../helpers/seed';

async function fixture() {
  const fake = createFakeArtifacts();
  await fake.binding.create('r');
  const repo = fake.repos.get('r')!;
  const git = new GitService(new ArtifactsRepoClient(fake.binding, 'r'));
  return { repo, git };
}

describe('明确分支名称解析', () => {
  it('40 位分支名称读取分支头，泛用对象解析仍返回对象本身', async () => {
    const { repo, git } = await fixture();
    const old = await commitFiles(repo, 'main', { 'a.txt': 'old' }, 'old');
    const tip = await commitFiles(repo, old, { 'a.txt': 'tip' }, 'tip', [old]);
    expect(await git.resolveBranch(old)).toBe(tip);
    expect(await git.resolve(old)).toBe(old);
    expect(await git.resolveBranch('ab'.repeat(20))).toBeNull();
  });

  it('refs/heads 和 refs/tags 字样只作分支名称，不回退到完整引用或标签', async () => {
    const { repo, git } = await fixture();
    const main = await commitFiles(repo, 'main', { 'a.txt': 'main' }, 'main');
    const named = await commitFiles(
      repo,
      'refs/heads/main',
      { 'a.txt': 'named branch' },
      'named',
      [main]
    );
    repo.refs.set('refs/tags/release', main);
    expect(await git.resolveBranch('main')).toBe(main);
    expect(await git.resolveBranch('refs/heads/main')).toBe(named);
    expect(await git.resolveBranch('refs/heads/refs/heads/main')).toBeNull();
    expect(await git.resolveBranch('release')).toBeNull();
    expect(await git.resolveBranch('refs/tags/release')).toBeNull();
  });

  it('删除 40 位名称分支时以真实分支头作 CAS，不使用同名旧提交', async () => {
    const { repo, git } = await fixture();
    const old = await commitFiles(repo, 'main', { 'a.txt': 'old' }, 'old');
    await commitFiles(repo, old, { 'a.txt': 'tip' }, 'tip', [old]);
    await git.deleteBranch(old);
    expect(repo.refs.has(`refs/heads/${old}`)).toBe(false);
    expect(repo.refs.get('refs/heads/main')).toBe(old);
  });
});

/**
 * main: A ─ B ─ M (merges feat), feat: A ─ F, next: F ─ H (a follow-up built on the merged feature).
 * git merge-base main next = F; git log main..next = H.
 */
async function mergedFeature() {
  const { repo, git } = await fixture();
  const A = await commitFiles(repo, 'main', { 'a.txt': 'a\n' }, 'A');
  const F = await commitFiles(
    repo,
    'feat',
    { 'a.txt': 'a\n', 'f.txt': 'f\n' },
    'F',
    [A]
  );
  const B = await commitFiles(
    repo,
    'main',
    { 'a.txt': 'a\n', 'b.txt': 'b\n' },
    'B',
    [A]
  );
  const M = await commitFiles(
    repo,
    'main',
    { 'a.txt': 'a\n', 'b.txt': 'b\n', 'f.txt': 'f\n' },
    'Merge feat',
    [B, F]
  );
  const H = await commitFiles(
    repo,
    'next',
    { 'a.txt': 'a\n', 'f.txt': 'f\n', 'h.txt': 'h\n' },
    'H',
    [F]
  );
  return { git, A, B, F, M, H };
}

describe('历史遍历沿所有父提交进行', () => {
  it('合并基点可以经由合并提交的第二个父提交找到', async () => {
    const { git, F, M, H } = await mergedFeature();
    expect(await git.mergeBase(M, H)).toBe(F);
    expect(await git.mergeBase(H, M)).toBe(F);
  });

  it('base..head 不包含已经合入 base 的提交', async () => {
    const { git, M, H } = await mergedFeature();
    expect((await git.commitsBetween(M, H)).map((c) => c.hash)).toEqual([H]);
  });

  it('commitsBetween 先列父提交再列子提交', async () => {
    const { git, A, B, F, M } = await mergedFeature();
    const order = (await git.commitsBetween(A, M)).map((c) => c.hash);
    expect([...order].sort()).toEqual([B, F, M].sort());
    const at = (sha: string) => order.indexOf(sha);
    expect(at(B)).toBeLessThan(at(M));
    expect(at(F)).toBeLessThan(at(M));
  });

  it('isAncestor 判断经由第二个父提交的祖先关系', async () => {
    const { git, B, F, M, H } = await mergedFeature();
    expect(await git.isAncestor(F, M)).toBe(true);
    expect(await git.isAncestor(B, M)).toBe(true);
    expect(await git.isAncestor(M, H)).toBe(false);
    expect(await git.isAncestor(H, H)).toBe(true);
  });

  it('分叉点在 1000 个第一父提交之外时仍能找到合并基点', async () => {
    const { repo, git } = await fixture();
    const root = await commitFiles(repo, 'main', { 'a.txt': '0\n' }, 'root');
    const side = await commitFiles(
      repo,
      'side',
      { 'a.txt': '0\n', 's.txt': 's\n' },
      'side',
      [root]
    );
    let tip = root;
    for (let i = 1; i <= 1200; i++)
      tip = await commitFiles(repo, 'main', { 'a.txt': `${i}\n` }, `m${i}`);
    expect(await git.mergeBase(tip, side)).toBe(root);
    expect((await git.commitsBetween(tip, side)).map((c) => c.hash)).toEqual([
      side,
    ]);
  });

  it('没有共同历史时合并基点为 null', async () => {
    const { repo, git } = await fixture();
    const a = await commitFiles(repo, 'a', { 'a.txt': 'a\n' }, 'a', []);
    const b = await commitFiles(repo, 'b', { 'b.txt': 'b\n' }, 'b', []);
    expect(await git.mergeBase(a, b)).toBeNull();
    expect(await git.isAncestor(a, b)).toBe(false);
  });
});
