import { describe, expect, it, vi } from 'vitest';
import { GitService, type FileChange } from '../git/service';
import { ArtifactsRepoClient } from '../git/remote';
import { makeBlob } from '../git/objects';
import { createFakeArtifacts } from './helpers/fake-artifacts';

const change: FileChange = {
  path: 'large.txt',
  status: 'modified',
  oldHash: 'old',
  newHash: 'new',
  mode: '100644',
};

function service() {
  return new GitService(
    new ArtifactsRepoClient(createFakeArtifacts().binding, 'r')
  );
}

describe('blob 大小限制', () => {
  it('合并差异超出预算时拒绝，且不缓冲任一侧内容', async () => {
    const git = service();
    const oldBlob = new Blob([new Uint8Array(300 * 1024)]);
    const newBlob = new Blob([new Uint8Array(300 * 1024)]);
    const oldRead = vi.spyOn(oldBlob, 'arrayBuffer');
    const newRead = vi.spyOn(newBlob, 'arrayBuffer');
    vi.spyOn(git, 'readBlob').mockImplementation(async (sha) =>
      sha === 'old' ? oldBlob : newBlob
    );
    expect(await git.fileDiffs([change])).toMatchObject([
      { tooLarge: true, hunks: [] },
    ]);
    expect(oldRead).not.toHaveBeenCalled();
    expect(newRead).not.toHaveBeenCalled();
  });

  it('仍可生成较小的文本差异', async () => {
    const git = service();
    vi.spyOn(git, 'readBlob').mockImplementation(
      async (sha) => new Blob([sha === 'old' ? 'before\n' : 'after\n'])
    );
    expect(await git.fileDiffs([change])).toMatchObject([
      { tooLarge: false, additions: 1, deletions: 1 },
    ]);
  });

  it('无需远程访问即可提供暂存 blob 的大小和内容', async () => {
    const git = service();
    const object = await makeBlob(new TextEncoder().encode('staged'));
    git.stage([object]);
    const blob = await git.readBlob(object.sha);
    expect(blob?.size).toBe(6);
    expect(await blob?.text()).toBe('staged');
  });
});
