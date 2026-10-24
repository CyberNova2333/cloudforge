import { afterEach, describe, expect, it, vi } from 'vitest';
import { redactRequestLine } from '../lib/request-log';
import { call, makeEnv } from './helpers/app';

afterEach(() => vi.restoreAllMocks());

describe('请求日志脱敏', () => {
  it('隐去路径中的重置密码与邀请令牌，以及查询参数中的令牌类值', () => {
    expect(
      redactRequestLine(
        '<-- GET /api/auth/reset-password/AbC123?callbackURL=/reset-password'
      )
    ).toBe(
      '<-- GET /api/auth/reset-password/[redacted]?callbackURL=/reset-password'
    );
    expect(redactRequestLine('--> GET /api/invites/token/xyz 200 3ms')).toBe(
      '--> GET /api/invites/token/[redacted] 200 3ms'
    );
    expect(
      redactRequestLine(
        '<-- GET /api/auth/verify-email?token=eyJhbG.x.y&callbackURL=%2F'
      )
    ).toBe('<-- GET /api/auth/verify-email?token=[redacted]&callbackURL=%2F');
    expect(
      redactRequestLine('<-- GET /api/auth/oauth2/callback?code=abc&state=def')
    ).toBe('<-- GET /api/auth/oauth2/callback?code=[redacted]&state=def');
    expect(
      redactRequestLine('<-- GET /api/repos/octocat/app/pulls?state=open')
    ).toBe('<-- GET /api/repos/octocat/app/pulls?state=open');
    expect(redactRequestLine('<-- GET /api/repos/octocat/app/tree/main')).toBe(
      '<-- GET /api/repos/octocat/app/tree/main'
    );
  });

  it('应用的请求日志不包含令牌', async () => {
    const t = makeEnv();
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    });
    await call(t, '/api/invites/token/secret-invite-token');
    expect(lines.some((l) => l.includes('/api/invites/token/'))).toBe(true);
    expect(lines.join('\n')).not.toContain('secret-invite-token');
  });
});
