import { describe, expect, it } from 'vitest';
import { openWithoutAccount } from './signIn';

describe('openWithoutAccount：无需账户访问', () => {
  it('未注册用户可以访问首页和仓库页面', () => {
    expect(openWithoutAccount('/')).toBe(true);
    expect(openWithoutAccount('/octocat/app')).toBe(true);
    expect(openWithoutAccount('/octocat/app/pull/3/files')).toBe(true);
    expect(openWithoutAccount('/octocat/app/actions/runs/1')).toBe(true);
  });

  it('个人资料和应用内部页面仍需登录', () => {
    expect(openWithoutAccount('/octocat')).toBe(false);
    expect(openWithoutAccount('/repos')).toBe(false);
    expect(openWithoutAccount('/settings/tokens')).toBe(false);
    expect(openWithoutAccount('/admin/usage')).toBe(false);
    expect(openWithoutAccount('/approvals/abc')).toBe(false);
    expect(openWithoutAccount('/oauth/consent')).toBe(false);
  });
});
