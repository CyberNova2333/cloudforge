import { describe, expect, it } from 'vitest';
import { ArtifactsRepoClient } from '../../git/remote';
import { GitService } from '../../git/service';
import { rebase, REBASE_COMMITTER } from '../../git/rebase';
import { patchId } from '../../git/patch-id';
import { encoder } from '../../git/bytes';
import { createFakeArtifacts } from '../helpers/fake-artifacts';
import { commitFiles } from '../helpers/seed';

const AT = { ...REBASE_COMMITTER, timestamp: 1_800_000_000 };
/** GBK "中文": not valid UTF-8, and decodes to replacement characters. */
const GBK = [0xd6, 0xd0, 0xce, 0xc4];
const BOM = [0xef, 0xbb, 0xbf];

/** 20 lines; `tags` appends text to some of them. Each line carries `extra` bytes after its number. */
function lines(tags: Record<number, string>, extra: number[] = []) {
  const out: number[] = [];
  for (let i = 1; i <= 20; i++)
    out.push(
      ...encoder.encode(`line ${i} `),
      ...extra,
      ...encoder.encode(`${tags[i] ?? ''}\n`)
    );
  return new Uint8Array(out);
}

// commitFiles takes strings, but makeBlob writes a Uint8Array as it is.
const raw = (b: Uint8Array) => b as unknown as string;

async function fixture() {
  const fake = createFakeArtifacts();
  await fake.binding.create('r');
  const repo = fake.repos.get('r')!;
  const git = new GitService(new ArtifactsRepoClient(fake.binding, 'r'));
  return { repo, git };
}

/** Rebases a branch that edits line 2 onto a target that edited line 18 of the same file. */
async function rebaseBothSides(
  file: (tags: Record<number, string>) => Uint8Array
) {
  const { repo, git } = await fixture();
  const root = await commitFiles(
    repo,
    'main',
    { 'f.txt': raw(file({})) },
    'base'
  );
  const head = await commitFiles(
    repo,
    'feature',
    { 'f.txt': raw(file({ 2: ' pr' })) },
    'PR edit',
    [root]
  );
  const onto = await commitFiles(
    repo,
    'main',
    { 'f.txt': raw(file({ 18: ' main' })) },
    'Main moves'
  );
  const r = await rebase(git, { head, onto, committer: AT, ontoLabel: 'main' });
  if (r.kind !== 'done') throw new Error(`预期为 done，实际为 ${r.kind}`);
  repo.add(...r.objects);
  const at = await git.entryAt(r.head, 'f.txt');
  if (at?.type !== 'blob') throw new Error('f.txt 不存在');
  return { result: r, bytes: (await git.blob(at.entry.hash))! };
}

describe('合并与变基保留文件的原始字节', () => {
  it('GBK 文件两边都改过时，干净合并逐字节保留', async () => {
    const file = (tags: Record<number, string>) => lines(tags, GBK);
    const { bytes } = await rebaseBothSides(file);
    expect([...bytes]).toEqual([...file({ 2: ' pr', 18: ' main' })]);
  });

  it('UTF-8 文件的 BOM 不会在合并时丢失', async () => {
    const file = (tags: Record<number, string>) =>
      new Uint8Array([...BOM, ...lines(tags, [...encoder.encode('中文')])]);
    const { bytes } = await rebaseBothSides(file);
    expect([...bytes]).toEqual([...file({ 2: ' pr', 18: ' main' })]);
  });

  it('GBK 文件冲突时按二进制处理，不作为文本冲突交给 AI', async () => {
    const { repo, git } = await fixture();
    const file = (tags: Record<number, string>) => lines(tags, GBK);
    const root = await commitFiles(
      repo,
      'main',
      { 'f.txt': raw(file({})) },
      'base'
    );
    const head = await commitFiles(
      repo,
      'feature',
      { 'f.txt': raw(file({ 5: ' pr' })) },
      'PR edit',
      [root]
    );
    const onto = await commitFiles(
      repo,
      'main',
      { 'f.txt': raw(file({ 5: ' main' })) },
      'Main edits the same line'
    );
    const r = await rebase(git, {
      head,
      onto,
      committer: AT,
      ontoLabel: 'main',
    });
    expect(r.kind).toBe('conflict');
    if (r.kind !== 'conflict') return;
    expect(r.conflicts).toEqual(['f.txt']);
    expect(r.files).toEqual([]);
  });

  it('patch-id 能区分解码后看起来相同的不同字节', async () => {
    const { repo, git } = await fixture();
    const before = lines({}, GBK);
    // The same text, but the GBK bytes replaced by what a lossy decode would show (U+FFFD in UTF-8).
    const replaced = lines({}, [0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd]);
    const edited = (b: Uint8Array) => {
      const copy = [...b];
      copy.push(...encoder.encode('extra\n'));
      return new Uint8Array(copy);
    };
    const c0 = await commitFiles(repo, 'a', { 'f.txt': raw(before) }, '0');
    const c1 = await commitFiles(
      repo,
      'a',
      { 'f.txt': raw(edited(before)) },
      '1'
    );
    const d0 = await commitFiles(repo, 'b', { 'f.txt': raw(replaced) }, '0');
    const d1 = await commitFiles(
      repo,
      'b',
      { 'f.txt': raw(edited(replaced)) },
      '1'
    );
    const tree = async (sha: string) => repo.parseCommit(sha)!.treeHash;
    // Adding the same line to either file is the same change...
    expect(await patchId(git, await tree(c0), await tree(c1))).toBe(
      await patchId(git, await tree(d0), await tree(d1))
    );
    // ...but turning the GBK file into the replaced one is a change, unlike a lossy decode would say.
    expect(await patchId(git, await tree(c0), await tree(d0))).not.toBe(
      await patchId(git, await tree(c0), await tree(c0))
    );
  });
});
