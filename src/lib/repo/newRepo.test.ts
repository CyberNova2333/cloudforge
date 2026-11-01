// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX,
  inviteFailureMessage,
  normalizeRepoName,
  repoNameProblem,
} from './newRepo';

describe('normalizeRepoName：规范化仓库名', () => {
  it('与服务端一样去除首尾空白，并将连续非法字符替换为一个连字符', () => {
    expect(normalizeRepoName('  my repo  ')).toBe('my-repo');
    expect(normalizeRepoName('a / b !! c')).toBe('a-b-c');
    expect(normalizeRepoName('keep.these_chars-ok')).toBe(
      'keep.these_chars-ok'
    );
  });
});

describe('repoNameProblem：仓库名问题', () => {
  it('空名称或普通名称不返回问题', () => {
    expect(repoNameProblem('')).toBeNull();
    expect(repoNameProblem('   ')).toBeNull();
    expect(repoNameProblem('client portal')).toBeNull();
    expect(repoNameProblem('invoices')).toBeNull();
  });

  it('拒绝服务端拒绝的名称', () => {
    expect(repoNameProblem('..')).toMatch(/dots/);
    expect(repoNameProblem(' . ')).toMatch(/dots/);
    expect(repoNameProblem('site.git')).toMatch(/\.git/);
    expect(repoNameProblem('a'.repeat(101))).toMatch(/100/);
    expect(repoNameProblem('a'.repeat(100))).toBeNull();
  });
});

describe('inviteFailureMessage：邀请失败消息', () => {
  it('所有评审者都已添加时为空', () => {
    expect(inviteFailureMessage([])).toBeNull();
  });

  it('服务端原因没有句号时补上句号', () => {
    expect(
      inviteFailureMessage([
        { name: 'Data', reason: 'You must be an admin of this repository' },
      ])
    ).toContain('repository. You can add reviewers');
  });

  it('说明无法添加的代理和后续操作', () => {
    expect(
      inviteFailureMessage([{ name: 'Data', reason: 'You must be an admin.' }])
    ).toBe(
      "The repository was created, but Data could not be added as a reviewer. You must be an admin. You can add reviewers in the repository's settings."
    );
    expect(
      inviteFailureMessage([
        { name: 'Data', reason: 'x.' },
        { name: 'Speed', reason: 'y.' },
        { name: 'Security', reason: 'z.' },
      ])
    ).toContain('Data, Speed and Security could not be added as reviewers.');
  });
});

describe('限制', () => {
  it('与服务端一致', () => {
    expect(DESCRIPTION_MAX).toBe(350);
  });
});
