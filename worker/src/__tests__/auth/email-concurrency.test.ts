import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../db/schema';
import { userEmails, type UserEmail } from '../../db/app.schema';
import {
  claimAlternateEmail,
  sendVerification,
  verifyAlternateEmail,
} from '../../members/http/emails-router';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';

function token(t: TestEnv) {
  const value = t.sent.at(-1)?.text?.match(/verify\?token=(\S+)/)?.[1];
  if (!value) throw new Error('未收到验证邮件');
  return value;
}

async function setup(expired = true) {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const bob = await addMember(t, admin, 'bob');
  const address = 'shared@work.example';
  expect(
    (await call(t, '/api/emails', { cookie: admin, json: { email: address } }))
      .status
  ).toBe(201);
  const oldToken = token(t);
  await t.env.DB.prepare(
    `UPDATE user_emails SET verification_sent_at = 1${expired ? ', verification_expires_at = 1' : ''}`
  ).run();
  const db = drizzle(t.env.DB, { schema });
  const existing = (await db.select().from(userEmails).get())!;
  const claimant = (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, 'bob'))
    .get())!;
  const row: UserEmail = {
    ...existing,
    id: crypto.randomUUID(),
    userId: claimant.id,
    verifiedAt: null,
    verificationTokenHash: null,
    verificationExpiresAt: null,
    verificationSentAt: null,
    createdAt: new Date(),
  };
  const read = () =>
    db.select().from(userEmails).where(eq(userEmails.email, address)).get();
  const resend = () =>
    call(t, `/api/emails/${existing.id}/resend`, {
      cookie: admin,
      method: 'POST',
    });
  return { t, db, admin, bob, address, existing, row, read, resend, oldToken };
}

describe('备用邮箱变更竞争', () => {
  it.each([false, true])(
    '过期快照已被刷新时保留原所有者（已验证：%s）',
    async (verify) => {
      const s = await setup();
      expect((await s.resend()).status).toBe(200);
      if (verify)
        expect(
          (
            await call(s.t, '/api/emails/verify', {
              cookie: s.admin,
              json: { token: token(s.t) },
            })
          ).status
        ).toBe(200);
      const current = await s.read();
      expect(
        await claimAlternateEmail(s.db, s.row, s.existing, new Date())
      ).toBe(false);
      expect(await s.read()).toEqual(current);
    }
  );

  it('即使过期时间恢复为旧值，也不替换已更新代次的令牌', async () => {
    const s = await setup();
    expect((await s.resend()).status).toBe(200);
    await s.t.env.DB.prepare(
      'UPDATE user_emails SET verification_expires_at = 1 WHERE id = ?'
    )
      .bind(s.existing.id)
      .run();
    const current = await s.read();
    expect(await claimAlternateEmail(s.db, s.row, s.existing, new Date())).toBe(
      false
    );
    expect(await s.read()).toEqual(current);
  });

  it('仍以原子方式替换未发生变化的过期备用邮箱', async () => {
    const s = await setup();
    expect(await claimAlternateEmail(s.db, s.row, s.existing, new Date())).toBe(
      true
    );
    expect((await s.read())?.id).toBe(s.row.id);
    expect(await s.db.select().from(userEmails).all()).toHaveLength(1);
  });

  it('重发已替换令牌后，不消耗旧令牌快照', async () => {
    const s = await setup(false);
    expect((await s.resend()).status).toBe(200);
    const current = await s.read();
    expect(await verifyAlternateEmail(s.db, s.existing)).toBeUndefined();
    expect(await s.read()).toEqual(current);
    expect(
      (
        await call(s.t, '/api/emails/verify', {
          cookie: s.admin,
          json: { token: token(s.t) },
        })
      ).status
    ).toBe(200);
  });

  it('请求读取后令牌才过期时，不进行验证', async () => {
    const s = await setup(false);
    expect(
      await verifyAlternateEmail(
        s.db,
        s.existing,
        new Date(s.existing.verificationExpiresAt!.getTime() + 1000)
      )
    ).toBeUndefined();
    expect((await s.read())?.verifiedAt).toBeNull();
  });

  it('验证已消耗令牌后，不发送过期的重发邮件', async () => {
    const s = await setup(false);
    expect(
      (
        await call(s.t, '/api/emails/verify', {
          cookie: s.admin,
          json: { token: s.oldToken },
        })
      ).status
    ).toBe(200);
    const current = await s.read();
    const sent = s.t.sent.length;
    expect(
      await sendVerification(
        { env: s.t.env, req: { url: 'http://test.local/api/emails' } },
        s.db,
        s.existing,
        'octocat'
      )
    ).toBeNull();
    expect(await s.read()).toEqual(current);
    expect(s.t.sent).toHaveLength(sent);
  });

  it('替换变更失去认领时返回 409', async () => {
    const s = await setup();
    await s.t.env.DB.prepare(
      'CREATE TRIGGER retain_email BEFORE DELETE ON user_emails BEGIN SELECT RAISE(IGNORE); END'
    ).run();
    try {
      const res = await call(s.t, '/api/emails', {
        cookie: s.bob,
        json: { email: s.address },
      });
      expect(res.status).toBe(409);
      expect(await s.read()).toEqual(s.existing);
    } finally {
      await s.t.env.DB.exec('DROP TRIGGER retain_email');
    }
  });

  it('消耗令牌不再更新任何记录时返回 409', async () => {
    const s = await setup(false);
    await s.t.env.DB.prepare(
      'CREATE TRIGGER retain_verification BEFORE UPDATE ON user_emails WHEN NEW.verified_at IS NOT NULL BEGIN SELECT RAISE(IGNORE); END'
    ).run();
    try {
      const res = await call(s.t, '/api/emails/verify', {
        cookie: s.admin,
        json: { token: s.oldToken },
      });
      expect(res.status).toBe(409);
      expect((await s.read())?.verifiedAt).toBeNull();
    } finally {
      await s.t.env.DB.exec('DROP TRIGGER retain_verification');
    }
  });

  it('重发不再更新任何记录时返回 409，且不发送链接', async () => {
    const s = await setup(false);
    const sent = s.t.sent.length;
    await s.t.env.DB.prepare(
      'CREATE TRIGGER retain_token BEFORE UPDATE ON user_emails BEGIN SELECT RAISE(IGNORE); END'
    ).run();
    try {
      expect((await s.resend()).status).toBe(409);
      expect(await s.read()).toEqual(s.existing);
      expect(s.t.sent).toHaveLength(sent);
    } finally {
      await s.t.env.DB.exec('DROP TRIGGER retain_token');
    }
  });
});
