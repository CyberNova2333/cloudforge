// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { agentPrompt, importFromGitHubPrompt } from './agentPrompt';
import type { RepoDetail } from './uiApi';

const repo = (empty: boolean) =>
  ({
    name: 'engine',
    fullName: 'ada/engine',
    cloneUrl: 'https://git.example.com/ada/engine.git',
    defaultBranch: 'main',
    empty,
  }) as RepoDetail;

describe('agentPrompt：代理提示词', () => {
  it('要求代理请用户自行克隆，避免令牌进入聊天', () => {
    const p = agentPrompt(repo(false), 'https://git.example.com');
    expect(p).toContain('! git clone https://git.example.com/ada/engine.git');
    expect(p).toContain('https://git.example.com/settings/tokens');
    expect(p).not.toMatch(/(cfp|gop)_[0-9a-f]/);
  });

  it('配置 Git LFS，并将拉取请求链接到比较页面', () => {
    const p = agentPrompt(repo(false), 'https://git.example.com');
    expect(p).toContain('git lfs install');
    expect(p).toContain('git lfs track');
    expect(p).toContain(
      'https://git.example.com/ada/engine/compare/main...<branch-name>'
    );
  });

  it('代理自行创建拉取请求时传入用户请求和会话标签', () => {
    const p = agentPrompt(repo(false), 'https://git.example.com', 'Orange');
    expect(p).toContain('cloudforge_create_pull_request');
    expect(p).toContain('`request`');
    expect(p).toContain('what I originally asked you for');
    expect(p).toContain('`session`');
    expect(p).toContain("Orange's tools");
  });

  it('仓库为空时帮助添加首批文件', () => {
    expect(agentPrompt(repo(true), 'https://git.example.com')).toContain(
      'This repository is empty'
    );
    expect(agentPrompt(repo(false), 'https://git.example.com')).not.toContain(
      'This repository is empty'
    );
  });
});

describe('importFromGitHubPrompt：从 GitHub 导入的提示词', () => {
  const p = importFromGitHubPrompt(repo(true), 'https://git.example.com');

  it('两条要求密码输入的命令均由用户自行运行', () => {
    expect(p).toContain(
      '! git clone --mirror <GitHub address> engine-github.git'
    );
    expect(p).toContain(
      '! git -C engine-github.git push --all https://git.example.com/ada/engine.git'
    );
    expect(p).not.toMatch(/(cfp|gop)_[0-9a-f]|ghp_/);
  });

  it('复制标签和 LFS 文件，且从不强制推送', () => {
    expect(p).toContain('lfs fetch --all');
    expect(p).toContain('push --tags https://git.example.com/ada/engine.git');
    expect(p).toContain(
      'lfs push --all https://git.example.com/ada/engine.git'
    );
    expect(p).not.toMatch(/--force|--mirror https:\/\/git\.example/);
    expect(p).toContain('Never force-push');
  });
});
