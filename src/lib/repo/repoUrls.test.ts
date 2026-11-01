// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { dirOf, repoImageSrc, repoLinkHref, resolveRepoPath } from './repoUrls';

const root = { owner: 'octocat', repo: 'cloudforge', ref: 'main', dir: '' };
const nested = { ...root, dir: 'docs/guides' };
const raw = (ref: string, path: string) =>
  `/api/repos/octocat/cloudforge/raw?${new URLSearchParams({ ref, path })}`;

describe('repoImageSrc：仓库图片地址', () => {
  it('根目录 README 旁的图片指向原始文件接口', () => {
    expect(repoImageSrc(root, 'docs/screenshots/repository.jpg')).toBe(
      raw('main', 'docs/screenshots/repository.jpg')
    );
    expect(repoImageSrc(root, './logo.png')).toBe(raw('main', 'logo.png'));
  });

  it('相对嵌套 README 所在目录解析', () => {
    expect(repoImageSrc(nested, 'img/flow.png')).toBe(
      raw('main', 'docs/guides/img/flow.png')
    );
  });

  it('处理 ../ 和根目录相对路径', () => {
    expect(repoImageSrc(nested, '../screenshots/a.jpg')).toBe(
      raw('main', 'docs/screenshots/a.jpg')
    );
    expect(repoImageSrc(nested, '../../../../a.jpg')).toBe(
      raw('main', 'a.jpg')
    );
    expect(repoImageSrc(nested, '/docs/b.png')).toBe(raw('main', 'docs/b.png'));
  });

  it('百分号编码仅解码一次并保留引用', () => {
    expect(
      repoImageSrc({ ...root, ref: 'feature/x' }, 'my%20shot.png?v=1')
    ).toBe(raw('feature/x', 'my shot.png'));
  });

  it('保留绝对 URL 和 data URL', () => {
    for (const src of [
      'https://example.com/a.png',
      'http://example.com/a.png',
      '//cdn.example.com/a.png',
      'data:image/png;base64,AAAA',
      '',
    ])
      expect(repoImageSrc(root, src)).toBeNull();
  });
});

describe('repoLinkHref：仓库链接地址', () => {
  it('将根目录 README 中的文件链接指向文件视图', () => {
    expect(repoLinkHref(root, 'docs/setup.md')).toBe(
      '/octocat/cloudforge/blob/main/docs/setup.md'
    );
  });

  it('从嵌套文件解析 ./、../ 和根目录相对链接', () => {
    expect(repoLinkHref(nested, './auto-merge.md')).toBe(
      '/octocat/cloudforge/blob/main/docs/guides/auto-merge.md'
    );
    expect(repoLinkHref(nested, '../setup.md')).toBe(
      '/octocat/cloudforge/blob/main/docs/setup.md'
    );
    expect(repoLinkHref(nested, '/README.md')).toBe(
      '/octocat/cloudforge/blob/main/README.md'
    );
  });

  it('保留片段标识', () => {
    expect(repoLinkHref(root, 'docs/setup.md#deploying')).toBe(
      '/octocat/cloudforge/blob/main/docs/setup.md#deploying'
    );
  });

  it('目录使用树视图', () => {
    expect(repoLinkHref(root, 'docs/')).toBe(
      '/octocat/cloudforge/tree/main/docs'
    );
    expect(repoLinkHref(nested, '..')).toBe(
      '/octocat/cloudforge/tree/main/docs'
    );
    expect(repoLinkHref(root, '/')).toBe('/octocat/cloudforge/tree/main');
  });

  it('对 URL 中的引用和路径分段编码', () => {
    expect(repoLinkHref({ ...root, ref: 'feature/x' }, 'docs/my file.md')).toBe(
      '/octocat/cloudforge/blob/feature/x/docs/my%20file.md'
    );
  });

  it('保留绝对 URL 和锚点', () => {
    for (const href of [
      'https://example.com',
      'http://example.com/x.md',
      'mailto:me@example.com',
      '//example.com/x',
      '#section',
      '',
    ])
      expect(repoLinkHref(root, href)).toBeNull();
  });
});

describe('辅助函数', () => {
  it('dirOf 去除文件名', () => {
    expect(dirOf('README.md')).toBe('');
    expect(dirOf('docs/a/README.md')).toBe('docs/a');
  });

  it('resolveRepoPath 将仅含片段的路径判为非相对路径', () => {
    expect(resolveRepoPath('docs', '#x')).toBeNull();
    expect(resolveRepoPath('docs', '?x=1')).toBeNull();
  });
});
