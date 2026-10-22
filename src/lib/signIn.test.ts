import { describe, expect, it } from 'vitest';
import { openWithoutAccount } from './signIn';

describe('openWithoutAccount', () => {
  it('opens home and repository pages to someone without an account', () => {
    expect(openWithoutAccount('/')).toBe(true);
    expect(openWithoutAccount('/octocat/app')).toBe(true);
    expect(openWithoutAccount('/octocat/app/pull/3/files')).toBe(true);
    expect(openWithoutAccount('/octocat/app/actions/runs/1')).toBe(true);
  });

  it('keeps profiles and the app’s own pages behind sign-in', () => {
    expect(openWithoutAccount('/octocat')).toBe(false);
    expect(openWithoutAccount('/repos')).toBe(false);
    expect(openWithoutAccount('/settings/tokens')).toBe(false);
    expect(openWithoutAccount('/admin/usage')).toBe(false);
    expect(openWithoutAccount('/approvals/abc')).toBe(false);
    expect(openWithoutAccount('/oauth/consent')).toBe(false);
  });
});
