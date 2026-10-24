// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { installationIdOf, resourceNames, validateName } from '../names.ts';

describe('资源名称', () => {
  it('默认名称与当前文档中的名称一致', () => {
    expect(resourceNames('cloudforge')).toEqual({
      worker: 'cloudforge',
      d1: 'cloudforge-db',
      lfs: 'cloudforge-lfs',
      actionsLogs: 'cloudforge-actions-logs',
      actionsCache: 'cloudforge-actions-cache',
      artifacts: 'cloudforge',
      actionsWorkflow: 'cloudforge-actions-run',
      mergeWorkflow: 'cloudforge-merge-resolution',
    });
  });

  it('validateName 拒绝无效名称并接受有效名称', () => {
    for (const bad of ['ab', 'a'.repeat(31), '-x1', 'x1-', 'Git', 'a_b']) {
      expect(validateName(bad), bad).toEqual(expect.any(String));
    }
    expect(validateName('cloudforge')).toBeNull();
    expect(validateName('git-1')).toBeNull();
  });

  it('installationIdOf 保持稳定且依赖主机名', () => {
    const a = installationIdOf('acct', 'cloudforge', 'workers.dev');
    expect(a).toMatch(/^cloudforge-[0-9a-f]{12}$/);
    expect(installationIdOf('acct', 'cloudforge', 'workers.dev')).toBe(a);
    expect(installationIdOf('acct', 'cloudforge', 'git.example.com')).not.toBe(
      a
    );
  });
});
