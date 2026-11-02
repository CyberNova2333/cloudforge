// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redactRequestLine } from '../../http/request-log';
import { call, makeEnv } from '../helpers/app';

afterEach(() => vi.restoreAllMocks());

describe('请求日志脱敏', () => {
  it('认证回调的编码参数名同样脱敏，普通业务状态仍可记录', () => {
    expect(
      redactRequestLine(
        '<-- GET /api/auth/oidc/callback/company?co%64e=private-code&st%61te=private-state&other=ok'
      )
    ).toBe(
      '<-- GET /api/auth/oidc/callback/company?co%64e=[redacted]&st%61te=[redacted]&other=ok'
    );
    expect(
      redactRequestLine('<-- GET /api/auth/verify-email?t%6fken=private-token')
    ).toBe('<-- GET /api/auth/verify-email?t%6fken=[redacted]');
    expect(redactRequestLine('<-- GET /api/repos/a/b/pulls?state=open')).toBe(
      '<-- GET /api/repos/a/b/pulls?state=open'
    );
  });
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
    ).toBe(
      '<-- GET /api/auth/oauth2/callback?code=[redacted]&state=[redacted]'
    );
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
    await call(
      t,
      '/api/auth/oidc/callback/company?co%64e=private-callback-code&st%61te=private-callback-state'
    );
    expect(lines.some((l) => l.includes('/api/invites/token/'))).toBe(true);
    expect(lines.join('\n')).not.toContain('secret-invite-token');
    expect(lines.join('\n')).not.toContain('private-callback-code');
    expect(lines.join('\n')).not.toContain('private-callback-state');
  });
});
