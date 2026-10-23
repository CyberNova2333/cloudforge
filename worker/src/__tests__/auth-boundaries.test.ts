import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { usersByCommitEmail } from '../lib/commit-authors';
import { addMember, bootstrapAdmin, call, makeEnv } from './helpers/app';
import { commitFiles } from './helpers/seed';

describe('primary and alternate mailbox ownership', () => {
  it('rejects signup, admin creation and admin email updates using another member’s alternate', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'bob');
    const bob = (await t.env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    )
      .bind('bob')
      .first<{ id: string }>())!;
    const alternate = 'verified-author@example.com';
    expect(
      (
        await call(t, '/api/emails', {
          cookie: admin,
          json: { email: alternate },
        })
      ).status
    ).toBe(201);
    const token = t.sent.at(-1)!.text!.match(/token=(\S+)/)![1];
    expect(
      (await call(t, '/api/emails/verify', { cookie: admin, json: { token } }))
        .status
    ).toBe(200);
    await call(t, '/api/admin/settings/signup.enabled', {
      cookie: admin,
      method: 'PUT',
      json: { value: true },
    });
    expect(
      (
        await call(t, '/api/auth/sign-up/email', {
          json: {
            email: alternate,
            username: 'impostor',
            name: 'Impostor',
            password: 'password123',
          },
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(t, '/api/auth/admin/create-user', {
          cookie: admin,
          json: {
            email: alternate,
            name: 'Impostor',
            password: 'password123',
            data: { username: 'impostor' },
          },
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(t, '/api/auth/admin/update-user', {
          cookie: admin,
          json: { userId: bob.id, data: { email: alternate } },
        })
      ).status
    ).toBe(409);
    const db = drizzle(t.env.DB, { schema });
    expect(
      (await usersByCommitEmail(db, [alternate])).get(alternate)?.username
    ).toBe('octocat');
  });

  it('never attributes an unverified primary, including legacy primary/alternate collisions', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/admin/settings/signup.enabled', {
      cookie: admin,
      method: 'PUT',
      json: { value: true },
    });
    expect(
      (
        await call(t, '/api/auth/sign-up/email', {
          json: {
            email: 'unverified@example.com',
            username: 'newcomer',
            name: 'New',
            password: 'password123',
          },
        })
      ).status
    ).toBe(200);
    const db = drizzle(t.env.DB, { schema });
    expect(
      (await usersByCommitEmail(db, ['unverified@example.com'])).size
    ).toBe(0);
    // Existing databases may already contain this collision from the old signup route.
    const user = (await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.username, 'octocat'),
    }))!;
    await t.env.DB.prepare(
      'INSERT INTO user_emails (id, user_id, email, verified_at, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind('legacy-alternate', user.id, 'unverified@example.com', 1, 1)
      .run();
    expect(
      (await usersByCommitEmail(db, ['unverified@example.com'])).get(
        'unverified@example.com'
      )?.username
    ).toBe('octocat');
  });

  it('does not revive an expired alternate claim after its address became a primary', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    const address = 'new-primary@example.com';
    const added = await call(t, '/api/emails', {
      cookie: admin,
      json: { email: address },
    });
    const { email } = (await added.json()) as { email: { id: string } };
    const token = t.sent.at(-1)!.text!.match(/token=(\S+)/)![1];
    await t.env.DB.prepare(
      'UPDATE user_emails SET verification_expires_at = 1, verification_sent_at = 1 WHERE id = ?'
    )
      .bind(email.id)
      .run();
    expect(
      (
        await call(t, '/api/auth/admin/create-user', {
          cookie: admin,
          json: {
            email: address,
            name: 'New',
            password: 'password123',
            data: { username: 'newprimary' },
          },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(t, `/api/emails/${email.id}/resend`, {
          cookie: admin,
          method: 'POST',
        })
      ).status
    ).toBe(409);
    // A racing or legacy still-valid token must be checked against current primary ownership too.
    await t.env.DB.prepare(
      'UPDATE user_emails SET verification_expires_at = ? WHERE id = ?'
    )
      .bind(Math.floor(Date.now() / 1000) + 3600, email.id)
      .run();
    expect(
      (await call(t, '/api/emails/verify', { cookie: admin, json: { token } }))
        .status
    ).toBe(409);
  });
});

describe('repository path and file boundaries', () => {
  it('rejects the same reserved names when creating and renaming, keeping the old URL usable', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    expect(
      (
        await call(t, '/api/repos', {
          cookie: admin,
          json: { name: 'addressable', addReadme: true },
        })
      ).status
    ).toBe(201);
    for (const name of ['.', '..', 'repo.git']) {
      expect(
        (await call(t, '/api/repos', { cookie: admin, json: { name } })).status
      ).toBe(400);
      expect(
        (
          await call(t, '/api/repos/octocat/addressable', {
            cookie: admin,
            method: 'PATCH',
            json: { name },
          })
        ).status
      ).toBe(400);
      expect(
        (await call(t, '/api/repos/octocat/addressable', { cookie: admin }))
          .status
      ).toBe(200);
    }
    expect(
      (
        await call(t, '/api/repos/octocat/addressable', {
          cookie: admin,
          method: 'PATCH',
          json: { name: 'renamed' },
        })
      ).status
    ).toBe(200);
    expect(
      (await call(t, '/api/repos/octocat/renamed', { cookie: admin })).status
    ).toBe(200);
  });

  it('checks a large file or README size without reading its body', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await call(t, '/api/repos', {
      cookie: admin,
      json: { name: 'files', visibility: 'public' },
    });
    const size = 1024 * 1024 + 1;
    await commitFiles(
      [...t.fake.repos.values()][0],
      'main',
      { 'README.md': 'x'.repeat(size), 'small.txt': 'small' },
      'files'
    );
    const originalBuffer = Blob.prototype.arrayBuffer;
    const originalText = Blob.prototype.text;
    const buffer = vi
      .spyOn(Blob.prototype, 'arrayBuffer')
      .mockImplementation(function (this: Blob) {
        if (this.size === size) throw new Error('large body must not be read');
        return originalBuffer.call(this);
      });
    const text = vi.spyOn(Blob.prototype, 'text').mockImplementation(function (
      this: Blob
    ) {
      if (this.size === size) throw new Error('large text must not be read');
      return originalText.call(this);
    });
    try {
      const file = await call(
        t,
        '/api/repos/octocat/files/contents?refPath=main/README.md'
      );
      expect(file.status).toBe(200);
      expect(((await file.json()) as { file: unknown }).file).toMatchObject({
        size,
        tooLarge: true,
        text: null,
      });
      const tree = await call(
        t,
        '/api/repos/octocat/files/contents?refPath=main'
      );
      expect(tree.status).toBe(200);
      expect(((await tree.json()) as { readme: unknown }).readme).toBeNull();
      const small = await call(
        t,
        '/api/repos/octocat/files/contents?refPath=main/small.txt'
      );
      expect(((await small.json()) as { file: unknown }).file).toMatchObject({
        text: 'small',
        tooLarge: false,
      });
    } finally {
      buffer.mockRestore();
      text.mockRestore();
    }
  });
});
