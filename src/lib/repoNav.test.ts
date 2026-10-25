// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { repoBand, repoRest, repoTabOf, repoTabs } from './repoNav';

describe('repoRest：仓库剩余路径', () => {
  it('拆分并解码 /owner/repo 后的路径', () => {
    expect(repoRest('/o/r')).toEqual([]);
    expect(repoRest('/o/r/')).toEqual([]);
    expect(repoRest('/o/r/blob/main/src/a%20b.ts')).toEqual([
      'blob',
      'main',
      'src',
      'a b.ts',
    ]);
    // A malformed escape stays as it was rather than throwing.
    expect(repoRest('/o/r/tree/%E0%A4%A')).toEqual(['tree', '%E0%A4%A']);
  });
});

describe('repoTabOf：仓库当前标签', () => {
  it('在列表、单个拉取请求和比较页面标记拉取请求标签', () => {
    for (const rest of [
      ['pulls'],
      ['pull', '3'],
      ['pull', '3', 'files'],
      ['compare'],
      ['compare', 'main...feat'],
      ['session', 's-a3e258a5a3'],
    ])
      expect(repoTabOf(rest, false)).toBe('pulls');
  });

  it('在发行列表、单个发行版本和标签页面标记发行标签', () => {
    for (const rest of [['releases'], ['releases', 'v1.2.0'], ['tags']])
      expect(repoTabOf(rest, false)).toBe('releases');
  });

  it('在议题列表、单个议题和标记页面标记议题标签', () => {
    for (const rest of [
      ['issues'],
      ['issues', '4'],
      ['issues', 'new'],
      ['labels'],
    ])
      expect(repoTabOf(rest, false)).toBe('issues');
  });

  it('在健康页面标记健康标签', () => {
    expect(repoTabOf(['health'], false)).toBe('health');
  });

  it('在各自页面标记自动化、洞察和设置标签', () => {
    expect(repoTabOf(['actions'], false)).toBe('actions');
    expect(repoTabOf(['actions', 'runs', '4', 'job', 'j'], false)).toBe(
      'actions'
    );
    expect(repoTabOf(['actions', 'agent', 'x'], false)).toBe('actions');
    expect(repoTabOf(['insights'], false)).toBe('insights');
    expect(repoTabOf(['settings'], false)).toBe('settings');
  });

  it('其他位置标记代码标签；提交页面也属于代码，代理仓库除外', () => {
    for (const rest of [
      [],
      ['tree', 'main'],
      ['blob', 'main', 'a.ts'],
      ['nope'],
    ])
      expect(repoTabOf(rest, false)).toBe('code');
    expect(repoTabOf(['commits', 'main'], false)).toBe('code');
    expect(repoTabOf(['commit', 'abc'], false)).toBe('code');
    expect(repoTabOf(['commits'], true)).toBe('commits');
    expect(repoTabOf(['commit', 'abc'], true)).toBe('commits');
  });
});

describe('repoTabs：仓库标签集合', () => {
  it('显示现有标签，仅管理员可见设置', () => {
    expect(repoTabs(false, true).map((t) => t.id)).toEqual([
      'code',
      'health',
      'issues',
      'pulls',
      'releases',
      'actions',
      'insights',
      'settings',
    ]);
    expect(repoTabs(false, false).map((t) => t.id)).toEqual([
      'code',
      'health',
      'issues',
      'pulls',
      'releases',
      'actions',
      'insights',
    ]);
  });

  it('仓库关闭议题时不显示议题标签', () => {
    expect(repoTabs(false, true, false).map((t) => t.id)).not.toContain(
      'issues'
    );
  });

  it('将发行标签放在拉取请求之后，并使用标签图标', () => {
    expect(repoTabs(false, false).find((t) => t.id === 'releases')).toEqual({
      id: 'releases',
      label: 'Releases',
      icon: 'tag',
      path: 'releases',
    });
  });

  it('代理仓库显示代码、提交和设置', () => {
    expect(repoTabs(true, true).map((t) => [t.id, t.path])).toEqual([
      ['code', ''],
      ['commits', 'commits'],
      ['settings', 'settings'],
    ]);
  });
});

describe('repoBand：仓库页面默认导航路径', () => {
  const base = '/o/r';

  it('在标签顶层页面显示标签名称', () => {
    expect(repoBand([], base, false)).toEqual({
      tab: 'code',
      icon: 'code',
      crumbs: [{ label: 'Code' }],
      title: 'Code',
    });
    expect(repoBand(['pulls'], base, false)).toMatchObject({
      tab: 'pulls',
      icon: 'pull',
      title: 'Pull requests',
    });
    expect(repoBand(['settings'], base, false).title).toBe('Settings');
    expect(repoBand(['health'], base, false)).toEqual({
      tab: 'health',
      icon: 'pulse',
      crumbs: [{ label: 'Health' }],
      title: 'Health',
    });
  });

  it('议题页面的导航路径', () => {
    expect(repoBand(['issues'], base, false).title).toBe('Issues');
    expect(repoBand(['issues', '7'], base, false)).toEqual({
      tab: 'issues',
      icon: 'issue',
      crumbs: [{ label: 'Issues', to: '/o/r/issues' }, { label: '#7' }],
      title: '#7',
    });
    expect(repoBand(['issues', 'new'], base, false).title).toBe('New issue');
    expect(repoBand(['labels'], base, false).title).toBe('Labels');
  });

  it('使用最后一个路径分段命名文件夹或文件', () => {
    expect(repoBand(['tree', 'main', 'src', 'lib'], base, false)).toEqual({
      tab: 'code',
      icon: 'code',
      crumbs: [{ label: 'lib' }],
      title: 'lib',
    });
    expect(repoBand(['blob', 'main', 'a.ts'], base, false)).toMatchObject({
      icon: 'file',
      title: 'a.ts',
    });
  });

  it('从单个条目链接回列表', () => {
    expect(repoBand(['pull', '12', 'files'], base, false)).toEqual({
      tab: 'pulls',
      icon: 'pull',
      crumbs: [{ label: 'Pull requests', to: '/o/r/pulls' }, { label: '#12' }],
      title: '#12',
    });
    expect(repoBand(['compare', 'a...b'], base, false).title).toBe(
      'New pull request'
    );
    expect(repoBand(['session', 's-a3e258a5a3'], base, false)).toEqual({
      tab: 'pulls',
      icon: 'pull',
      crumbs: [
        { label: 'Pull requests', to: '/o/r/pulls' },
        { label: 'Session' },
      ],
      title: 'Session',
    });
    expect(repoBand(['commit', 'abcdef1234567'], base, false)).toEqual({
      tab: 'code',
      icon: 'commit',
      crumbs: [{ label: 'Commits', to: '/o/r/commits' }, { label: 'abcdef1' }],
      title: 'abcdef1',
    });
    expect(repoBand(['actions', 'runs', '7'], base, false)).toMatchObject({
      crumbs: [{ label: 'Actions', to: '/o/r/actions' }, { label: 'Run #7' }],
      title: 'Run #7',
    });
    expect(repoBand(['actions', 'agent', 'x'], base, false).title).toBe(
      'Agent run'
    );
  });

  it('显示发行列表名称、发行版本标签，以及发行下的标签页面', () => {
    expect(repoBand(['releases'], base, false)).toEqual({
      tab: 'releases',
      icon: 'tag',
      crumbs: [{ label: 'Releases' }],
      title: 'Releases',
    });
    expect(repoBand(['releases', 'v1.2.0'], base, false)).toEqual({
      tab: 'releases',
      icon: 'tag',
      crumbs: [{ label: 'Releases', to: '/o/r/releases' }, { label: 'v1.2.0' }],
      title: 'v1.2.0',
    });
    expect(repoBand(['tags'], base, false)).toEqual({
      tab: 'releases',
      icon: 'tag',
      crumbs: [{ label: 'Releases', to: '/o/r/releases' }, { label: 'Tags' }],
      title: 'Tags',
    });
  });
});
