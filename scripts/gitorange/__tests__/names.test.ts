import { describe, expect, it } from 'vitest';
import { installationIdOf, resourceNames, validateName } from '../names.ts';

describe('names', () => {
  it("default name reproduces today's documented names", () => {
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

  it('validateName rejects bad names and accepts good ones', () => {
    for (const bad of ['ab', 'a'.repeat(31), '-x1', 'x1-', 'Git', 'a_b']) {
      expect(validateName(bad), bad).toEqual(expect.any(String));
    }
    expect(validateName('cloudforge')).toBeNull();
    expect(validateName('git-1')).toBeNull();
  });

  it('installationIdOf is stable and depends on the hostname', () => {
    const a = installationIdOf('acct', 'cloudforge', 'workers.dev');
    expect(a).toMatch(/^cloudforge-[0-9a-f]{12}$/);
    expect(installationIdOf('acct', 'cloudforge', 'workers.dev')).toBe(a);
    expect(installationIdOf('acct', 'cloudforge', 'git.example.com')).not.toBe(
      a
    );
  });
});
