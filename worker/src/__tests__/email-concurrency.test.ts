import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { userEmails, type UserEmail } from '../db/app.schema';
import {
  claimAlternateEmail,
  sendVerification,
  verifyAlternateEmail,
} from '../routers/emails-router';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from './helpers/app';

function token(t: TestEnv) {
  const value = t.sent.at(-1)?.text?.match(/verify\?token=(\S+)/)?.[1];
  if (!value) throw new Error('no verification email');
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

describe('alternate email mutation races', () => {
  it.each([false, true])(
    'preserves the prior owner when an expired snapshot is refreshed (verified: %s)',
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

  it('does not replace a changed token generation even when its expiry returns to the old value', async () => {
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

  it('still replaces an unchanged expired alternate atomically', async () => {
    const s = await setup();
    expect(await claimAlternateEmail(s.db, s.row, s.existing, new Date())).toBe(
      true
    );
    expect((await s.read())?.id).toBe(s.row.id);
    expect(await s.db.select().from(userEmails).all()).toHaveLength(1);
  });

  it('does not consume an old token snapshot after resend replaced it', async () => {
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

  it('does not verify a token that expired after the request read it', async () => {
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

  it('does not send a stale resend after verification consumed the token', async () => {
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

  it('returns 409 when the replacement mutation loses its claim', async () => {
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

  it('returns 409 when token consumption no longer updates a row', async () => {
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

  it('returns 409 without sending a link when resend no longer updates a row', async () => {
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
