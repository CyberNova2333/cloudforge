import { describe, expect, it, vi } from 'vitest';
import * as emailClaims from '../lib/email-claims';
import * as namespaces from '../lib/namespaces';
import { addMember, bootstrapAdmin, call, makeEnv } from './helpers/app';

async function invitation(role: 'admin' | 'user' = 'user') {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const created = await call(t, '/api/invites', {
    cookie: admin,
    json: { email: 'invited@example.com', role },
  });
  expect(created.status).toBe(201);
  const { invitation, inviteUrl } = (await created.json()) as {
    invitation: { id: string };
    inviteUrl: string;
  };
  const token = inviteUrl.split('/invite/')[1];
  const json = {
    token,
    name: 'Invited',
    username: 'invited',
    password: 'password123',
  };
  return { t, admin, id: invitation.id, token, json };
}

describe('invitation redemption races', () => {
  it('rejects expiry exactly at the current time without consuming the invitation', async () => {
    const s = await invitation();
    const now = Math.floor(Date.now() / 1000) * 1000;
    await s.t.env.DB.prepare(
      'UPDATE invitations SET expires_at = ? WHERE id = ?'
    )
      .bind(now / 1000, s.id)
      .run();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      expect((await call(s.t, `/api/invites/token/${s.token}`)).status).toBe(
        404
      );
      expect(
        (await call(s.t, '/api/invites/accept', { json: s.json })).status
      ).toBe(400);
      expect(
        await s.t.env.DB.prepare(
          'SELECT accepted_at FROM invitations WHERE id = ?'
        )
          .bind(s.id)
          .first()
      ).toEqual({ accepted_at: null });
      expect(
        await s.t.env.DB.prepare('SELECT id FROM users WHERE email = ?')
          .bind('invited@example.com')
          .first()
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('denies invitation management to anonymous, ordinary, and banned admin callers', async () => {
    const s = await invitation();
    const member = await addMember(s.t, s.admin, 'member');
    await s.t.env.DB.prepare(
      "UPDATE users SET banned = 1 WHERE username = 'octocat'"
    ).run();
    for (const [cookie, status] of [
      [undefined, 401],
      [member, 403],
      [s.admin, 401],
    ] as const) {
      expect((await call(s.t, '/api/invites', { cookie })).status).toBe(status);
      expect(
        (
          await call(s.t, '/api/invites', {
            cookie,
            json: { email: 'unauthorized@example.com', role: 'admin' },
          })
        ).status
      ).toBe(status);
      expect(
        (
          await call(s.t, `/api/invites/manage/${s.id}`, {
            cookie,
            method: 'DELETE',
          })
        ).status
      ).toBe(status);
    }
    expect((await call(s.t, `/api/invites/token/${s.token}`)).status).toBe(200);
    expect(
      await s.t.env.DB.prepare('SELECT id FROM invitations WHERE email = ?')
        .bind('unauthorized@example.com')
        .first()
    ).toBeNull();
  });

  it('fails closed if releasing a definitively failed claim also fails', async () => {
    const s = await invitation();
    await s.t.env.DB.prepare(
      `CREATE TRIGGER fail_invited_creation BEFORE INSERT ON users
      WHEN NEW.email = 'invited@example.com'
      BEGIN SELECT RAISE(ABORT, 'injected user creation failure'); END`
    ).run();
    await s.t.env.DB.prepare(
      `CREATE TRIGGER fail_invite_release BEFORE UPDATE OF accepted_at ON invitations
      WHEN OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS NULL
      BEGIN SELECT RAISE(ABORT, 'injected claim release failure'); END`
    ).run();
    try {
      expect(
        (await call(s.t, '/api/invites/accept', { json: s.json })).status
      ).toBe(500);
      expect(
        await s.t.env.DB.prepare('SELECT id FROM users WHERE email = ?')
          .bind('invited@example.com')
          .first()
      ).toBeNull();
      expect((await call(s.t, `/api/invites/token/${s.token}`)).status).toBe(
        404
      );
    } finally {
      await s.t.env.DB.exec('DROP TRIGGER fail_invited_creation');
      await s.t.env.DB.exec('DROP TRIGGER fail_invite_release');
    }
    expect(
      (await call(s.t, '/api/invites/accept', { json: s.json })).status
    ).toBe(400);
  });

  it('allows exactly one of two accepts that both read the same valid invitation', async () => {
    const s = await invitation('admin');
    const original = namespaces.namespaceTaken;
    let arrivals = 0;
    let release!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = vi
      .spyOn(namespaces, 'namespaceTaken')
      .mockImplementation(async (...args) => {
        const taken = await original(...args);
        if (++arrivals === 2) release();
        await bothReady;
        return taken;
      });
    try {
      const responses = await Promise.all(
        ['first', 'second'].map((username) =>
          call(s.t, '/api/invites/accept', { json: { ...s.json, username } })
        )
      );
      expect(arrivals).toBe(2);
      expect(responses.map((res) => res.status).sort()).toEqual([200, 400]);
      expect(
        (
          await s.t.env.DB.prepare('SELECT role FROM users WHERE email = ?')
            .bind('invited@example.com')
            .all()
        ).results
      ).toEqual([{ role: 'admin' }]);
      expect(
        (
          await s.t.env.DB.prepare(
            'SELECT accounts.id FROM accounts JOIN users ON users.id = accounts.user_id WHERE users.email = ?'
          )
            .bind('invited@example.com')
            .all()
        ).results
      ).toHaveLength(1);
      expect((await call(s.t, `/api/invites/token/${s.token}`)).status).toBe(
        404
      );
    } finally {
      release();
      gate.mockRestore();
    }
  });

  it.each(['admin', 'user'] as const)(
    'grants only the stored %s role and email',
    async (role) => {
      const s = await invitation(role);
      expect(
        (
          await call(s.t, '/api/invites/accept', {
            json: {
              ...s.json,
              role: role === 'admin' ? 'user' : 'admin',
              email: 'other@example.com',
              data: { role: 'admin' },
            },
          })
        ).status
      ).toBe(200);
      expect(
        await s.t.env.DB.prepare(
          'SELECT email, role, email_verified FROM users WHERE username = ?'
        )
          .bind(s.json.username)
          .first()
      ).toEqual({ email: 'invited@example.com', role, email_verified: 1 });
    }
  );

  it.each([false, true])(
    'does not recreate an invitation revoked after its claim (creation fails: %s)',
    async (fails) => {
      const s = await invitation('admin');
      if (fails)
        await s.t.env.DB.prepare(
          `CREATE TRIGGER fail_revoked_invited_user BEFORE INSERT ON users
      WHEN NEW.email = 'invited@example.com'
      BEGIN SELECT RAISE(ABORT, 'injected user creation failure'); END`
        ).run();
      const original = emailClaims.emailClaimedByOther;
      const gate = vi
        .spyOn(emailClaims, 'emailClaimedByOther')
        .mockImplementationOnce(async (...args) => {
          expect(
            (
              await s.t.env.DB.prepare(
                'SELECT accepted_at FROM invitations WHERE id = ?'
              )
                .bind(s.id)
                .first<{ accepted_at: number | null }>()
            )?.accepted_at
          ).not.toBeNull();
          expect(
            (
              await call(s.t, `/api/invites/manage/${s.id}`, {
                cookie: s.admin,
                method: 'DELETE',
              })
            ).status
          ).toBe(200);
          return original(...args);
        });
      try {
        expect(
          (await call(s.t, '/api/invites/accept', { json: s.json })).status
        ).toBe(fails ? 400 : 200);
        expect(gate).toHaveBeenCalledOnce();
        expect(
          await s.t.env.DB.prepare('SELECT id FROM invitations WHERE id = ?')
            .bind(s.id)
            .first()
        ).toBeNull();
        const user = await s.t.env.DB.prepare(
          'SELECT role FROM users WHERE email = ?'
        )
          .bind('invited@example.com')
          .first();
        expect(user).toEqual(fails ? null : { role: 'admin' });
        expect(
          (await call(s.t, '/api/invites/accept', { json: s.json })).status
        ).toBe(400);
      } finally {
        gate.mockRestore();
        if (fails)
          await s.t.env.DB.exec('DROP TRIGGER fail_revoked_invited_user');
      }
    }
  );

  it('does not replace, elevate, or unban an account created after the invitation was issued', async () => {
    const s = await invitation('admin');
    await addMember(s.t, s.admin, 'invited');
    await s.t.env.DB.prepare('UPDATE users SET banned = 1 WHERE email = ?')
      .bind('invited@example.com')
      .run();
    const query = s.t.env.DB.prepare(
      'SELECT users.id, users.role, users.banned, accounts.password FROM users JOIN accounts ON accounts.user_id = users.id WHERE users.email = ?'
    ).bind('invited@example.com');
    const before = await query.first();
    expect(
      (
        await call(s.t, '/api/invites/accept', {
          json: {
            ...s.json,
            username: 'replacement',
            password: 'replacement-password',
          },
        })
      ).status
    ).toBe(400);
    expect(await query.first()).toEqual(before);
    expect(before).toMatchObject({ role: 'user', banned: 1 });
    expect((await call(s.t, `/api/invites/token/${s.token}`)).status).toBe(404);
  });

  it('keeps the invitation consumed if credential creation fails after the user was inserted', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const created = await call(t, '/api/invites', {
      cookie: admin,
      json: { email: 'partial@example.com' },
    });
    const { inviteUrl } = (await created.json()) as { inviteUrl: string };
    const token = inviteUrl.split('/invite/')[1];
    await t.env.DB.prepare(
      `CREATE TRIGGER fail_invited_credential BEFORE INSERT ON accounts
      WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND email = 'partial@example.com')
      BEGIN SELECT RAISE(ABORT, 'injected credential creation failure'); END`
    ).run();
    try {
      expect(
        (
          await call(t, '/api/invites/accept', {
            json: {
              token,
              name: 'Partial',
              username: 'partial',
              password: 'password123',
            },
          })
        ).status
      ).toBe(400);
      expect(
        await t.env.DB.prepare('SELECT id FROM users WHERE email = ?')
          .bind('partial@example.com')
          .first()
      ).not.toBeNull();
      expect((await call(t, `/api/invites/token/${token}`)).status).toBe(404);
    } finally {
      await t.env.DB.exec('DROP TRIGGER fail_invited_credential');
    }
    expect(
      (
        await call(t, '/api/invites/accept', {
          json: {
            token,
            name: 'Replay',
            username: 'replay',
            password: 'password123',
          },
        })
      ).status
    ).toBe(400);
    expect(
      (
        await t.env.DB.prepare(
          'SELECT accounts.id FROM accounts JOIN users ON users.id = accounts.user_id WHERE users.email = ?'
        )
          .bind('partial@example.com')
          .all()
      ).results
    ).toHaveLength(0);
  });

  it('allows retry after a definite account creation failure without creating two accounts', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const created = await call(t, '/api/invites', {
      cookie: admin,
      json: { email: 'retry@example.com' },
    });
    const { inviteUrl } = (await created.json()) as { inviteUrl: string };
    const token = inviteUrl.split('/invite/')[1];
    const json = {
      token,
      name: 'Retry',
      username: 'retry',
      password: 'password123',
    };
    await t.env.DB.prepare(
      `CREATE TRIGGER fail_invited_user BEFORE INSERT ON users
      WHEN NEW.email = 'retry@example.com'
      BEGIN SELECT RAISE(ABORT, 'injected user creation failure'); END`
    ).run();
    try {
      expect((await call(t, '/api/invites/accept', { json })).status).toBe(400);
      expect((await call(t, `/api/invites/token/${token}`)).status).toBe(200);
    } finally {
      await t.env.DB.exec('DROP TRIGGER fail_invited_user');
    }
    expect((await call(t, '/api/invites/accept', { json })).status).toBe(200);
    expect((await call(t, '/api/invites/accept', { json })).status).toBe(400);
  });

  it.each([
    'revoked',
    'expired',
    'consumed',
    'role-changed',
    'email-changed',
    'token-changed',
  ])(
    'refuses an invitation %s after the initial token lookup',
    async (change) => {
      const t = makeEnv();
      const admin = await bootstrapAdmin(t);
      const created = await call(t, '/api/invites', {
        cookie: admin,
        json: { email: 'invited@example.com', role: 'admin' },
      });
      const { invitation, inviteUrl } = (await created.json()) as {
        invitation: { id: string };
        inviteUrl: string;
      };
      const original = namespaces.namespaceTaken;
      const gate = vi
        .spyOn(namespaces, 'namespaceTaken')
        .mockImplementationOnce(async (...args) => {
          if (change === 'revoked') {
            expect(
              (
                await call(t, `/api/invites/manage/${invitation.id}`, {
                  cookie: admin,
                  method: 'DELETE',
                })
              ).status
            ).toBe(200);
          } else {
            const updates: Record<string, string> = {
              expired: 'expires_at = 1',
              consumed: 'accepted_at = 1',
              'role-changed': "role = 'user'",
              'email-changed': "email = 'changed@example.com'",
              'token-changed': "token_hash = 'changed-token-hash'",
            };
            await t.env.DB.prepare(
              `UPDATE invitations SET ${updates[change]} WHERE id = ?`
            )
              .bind(invitation.id)
              .run();
          }
          return original(...args);
        });
      try {
        const res = await call(t, '/api/invites/accept', {
          json: {
            token: inviteUrl.split('/invite/')[1],
            name: 'Invited',
            username: 'invited',
            password: 'password123',
          },
        });
        expect(res.status).toBe(400);
        expect(
          await t.env.DB.prepare('SELECT id FROM users WHERE email = ?')
            .bind('invited@example.com')
            .first()
        ).toBeNull();
      } finally {
        gate.mockRestore();
      }
    }
  );
});
