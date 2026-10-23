// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { adminSection, settingsSection } from './siteNav';

describe('settingsSection：设置区域', () => {
  it('识别三个页面，验证链接归入邮箱', () => {
    expect(settingsSection('/settings/tokens')).toBe('tokens');
    expect(settingsSection('/settings/mcp')).toBe('mcp');
    expect(settingsSection('/settings/emails')).toBe('emails');
    expect(settingsSection('/settings/emails/verify')).toBe('emails');
  });
  it('不识别其他页面', () => {
    expect(settingsSection('/settings')).toBeNull();
    expect(settingsSection('/settings/emailsx')).toBeNull();
    expect(settingsSection('/admin')).toBeNull();
  });
});

describe('adminSection：管理区域', () => {
  it('按片段标识将 /admin 划分为三个区域', () => {
    expect(adminSection('/admin', '')).toBe('people');
    expect(adminSection('/admin', '#invite')).toBe('people');
    expect(adminSection('/admin', '#setup')).toBe('setup');
    expect(adminSection('/admin', '#actions')).toBe('actions');
    expect(adminSection('/admin', '#settings')).toBe('settings');
  });
  it('为其他页面各自提供入口', () => {
    expect(adminSection('/admin/usage', '')).toBe('usage');
    expect(adminSection('/admin/audit', '')).toBe('audit');
    expect(adminSection('/admin/agents', '')).toBe('agents');
  });
  it('公共代理目录不归入站点管理', () => {
    expect(adminSection('/agents', '')).toBeNull();
    expect(adminSection('/agents/new', '')).toBeNull();
  });
  it('管理区域之外不标记站点管理', () => {
    expect(adminSection('/settings/tokens', '')).toBeNull();
    expect(adminSection('/', '')).toBeNull();
  });
});
