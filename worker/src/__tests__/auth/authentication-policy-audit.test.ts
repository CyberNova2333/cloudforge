// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { applyPolicy } from '../../auth/policy-management';
import { readPolicy } from '../../auth/policy';
import { API_BODY_LIMIT, app } from '../../index';
import { addMember, bootstrapAdmin, call, makeEnv } from '../helpers/app';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // D1's write-time clock stays real: keep the fixed TOTP midpoint in the past.
  vi.setSystemTime(
    Math.floor((Date.now() - 15_000) / 30_000) * 30_000 + 15_000
  );
});
afterEach(() => vi.useRealTimers());

async function adminPreview() {
  const t = makeEnv();
  let cookie = await bootstrapAdmin(t);
  const begin = await call(t, '/api/auth/two-factor/enable', {
    cookie,
    json: { password: 'password123' },
  });
  expect(begin.status).toBe(200);
  const enrollment = (await begin.json()) as { totpURI: string };
  const otp = createOTP(
    new TextDecoder().decode(
      base32.decode(new URL(enrollment.totpURI).searchParams.get('secret')!)
    )
  );
  const confirmed = await call(t, '/api/auth/two-factor/verify-totp', {
    cookie,
    json: { code: await otp.totp() },
  });
  expect(confirmed.status).toBe(200);
  cookie = confirmed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const identity = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { session: { id: string }; user: { id: string } };
  const response = await call(t, '/api/admin/authentication-policy/preview', {
    cookie,
    json: { requireMfa: true },
  });
  expect(response.status).toBe(200);
  return {
    t,
    cookie,
    sessionId: identity.session.id,
    userId: identity.user.id,
    preview: (await response.json()) as { previewId: string; digest: string },
  };
}

describe('实例认证策略的独立边界复核', () => {
  it('认证策略状态在未登录和无管理权限时也禁止缓存', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const member = await addMember(t, admin, 'ordinary');
    const responses = [
      await call(t, '/api/me/authentication-policy'),
      await call(t, '/api/admin/authentication-policy'),
      await call(t, '/api/admin/authentication-policy', { cookie: member }),
    ];
    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 403,
    ]);
    expect(
      responses.map((response) => response.headers.get('cache-control'))
    ).toEqual(['no-store', 'no-store', 'no-store']);
  });

  it('认证策略在跨站写入或超大请求被前置中间件拒绝时也禁止缓存', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const rejected = await app.fetch(
      new Request('http://test.local/api/admin/authentication-policy/preview', {
        method: 'POST',
        headers: {
          cookie,
          origin: 'https://another.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ requireMfa: true }),
      }),
      t.env,
      t.ctx
    );
    const oversized = await app.fetch(
      new Request('http://test.local/api/admin/authentication-policy/apply', {
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://test.local',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ input: 'x'.repeat(API_BODY_LIMIT) }),
      }),
      t.env,
      t.ctx
    );
    expect([rejected.status, oversized.status]).toEqual([403, 413]);
    expect(
      [rejected, oversized].map((r) => r.headers.get('cache-control'))
    ).toEqual(['no-store', 'no-store']);
  });

  // Call the production write directly: admission middleware may already have accepted the
  // request when a concurrent authority change commits. The final D1 statement must fence it.
  for (const [name, mutation] of [
    ['管理员被降权', "UPDATE users SET role = 'user' WHERE id = ?"],
    ['管理员被封禁', 'UPDATE users SET banned = 1 WHERE id = ?'],
    ['浏览器会话过期', 'UPDATE sessions SET expires_at = 1 WHERE user_id = ?'],
    [
      '会话变为模拟身份',
      "UPDATE sessions SET impersonated_by = 'another-admin' WHERE user_id = ?",
    ],
    [
      '因子不再通过确认',
      'UPDATE two_factors SET verified = 0 WHERE user_id = ?',
    ],
  ])
    it(`${name}之后，已通过入口检查的旧计划仍在写点被拒绝`, async () => {
      const { t, sessionId, userId, preview } = await adminPreview();
      await t.env.DB.prepare(mutation).bind(userId).run();
      expect(
        await applyPolicy(
          t.env,
          sessionId,
          userId,
          preview.previewId,
          preview.digest
        )
      ).toBeNull();
      expect(await readPolicy(t.env)).toEqual({
        version: 0,
        requireMfa: false,
      });
      expect(
        await t.env.DB.prepare(
          'SELECT used_at FROM authentication_policy_previews WHERE id = ?'
        )
          .bind(preview.previewId)
          .first()
      ).toEqual({ used_at: null });
      expect(
        await t.env.DB.prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action = 'instance.authentication_policy'"
        ).first()
      ).toEqual({ n: 0 });
    });

  it('伪造摘要或借用同一管理员的另一浏览器身份都不能消费原预览', async () => {
    const { t, sessionId, userId, preview } = await adminPreview();
    expect(
      await applyPolicy(
        t.env,
        sessionId,
        userId,
        preview.previewId,
        '0'.repeat(64)
      )
    ).toBeNull();
    expect(
      await applyPolicy(
        t.env,
        'different-session',
        userId,
        preview.previewId,
        preview.digest
      )
    ).toBeNull();
    expect(
      await applyPolicy(
        t.env,
        sessionId,
        'different-user',
        preview.previewId,
        preview.digest
      )
    ).toBeNull();
    expect(await readPolicy(t.env)).toEqual({ version: 0, requireMfa: false });
    // Failed attempts leave the capability usable only by its original authorized browser.
    expect(
      await applyPolicy(
        t.env,
        sessionId,
        userId,
        preview.previewId,
        preview.digest
      )
    ).toEqual({ version: 1, requireMfa: true });
  });

  it('未明确确认离线恢复路径的请求不得发布策略', async () => {
    const { t, cookie, preview } = await adminPreview();
    for (const recoveryAcknowledged of [false, undefined]) {
      const response = await call(t, '/api/admin/authentication-policy/apply', {
        cookie,
        json: { ...preview, recoveryAcknowledged },
      });
      expect(response.status).toBe(400);
    }
    expect(await readPolicy(t.env)).toEqual({ version: 0, requireMfa: false });
  });
});
