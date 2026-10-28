// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../db/schema';
import { usersByCommitEmail } from '../lib/commit-authors';
import { addMember, bootstrapAdmin, call, makeEnv } from './helpers/app';
import { commitFiles } from './helpers/seed';

describe('认证响应的缓存边界', () => {
  it('会话与认证失败响应都禁止存储', async () => {
    const t = makeEnv();
    const cookie = await bootstrapAdmin(t);
    const responses = [
      await call(t, '/api/auth/get-session', { cookie }),
      await call(t, '/api/auth/sign-in/username', {
        json: { username: 'octocat', password: 'incorrect-password' },
      }),
      await call(t, '/api/auth/two-factor/enable', {
        json: { password: 'password123' },
      }),
    ];
    expect(responses[0].status).toBe(200);
    expect(responses[1].status).toBeGreaterThanOrEqual(400);
    expect(responses[2].status).toBeGreaterThanOrEqual(400);
    for (const response of responses) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Pragma')).toBe('no-cache');
    }
  });
});

describe('主邮箱与备用邮箱所有权', () => {
  it('拒绝使用其他成员备用邮箱注册、由管理员创建用户或更新邮箱', async () => {
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

  it('不归属未验证的主邮箱，包括历史主邮箱与备用邮箱冲突', async () => {
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

  it('地址已成为主邮箱后，不恢复过期的备用邮箱认领', async () => {
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

describe('仓库路径与文件边界', () => {
  it('创建和重命名时拒绝相同的保留名称，并保持旧 URL 可用', async () => {
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

  it('检查大文件或 README 大小时不读取正文', async () => {
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
        if (this.size === size) throw new Error('不应读取过大文件的正文');
        return originalBuffer.call(this);
      });
    const text = vi.spyOn(Blob.prototype, 'text').mockImplementation(function (
      this: Blob
    ) {
      if (this.size === size) throw new Error('不应读取过大文件的文本');
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
