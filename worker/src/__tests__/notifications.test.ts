// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import {
  agents,
  repositories,
  repositoryCollaborators,
} from '../db/app.schema';
import { users } from '../db/auth.schema';
import { readersAmong } from '../lib/notifications';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  settle,
  type TestEnv,
} from './helpers/app';
import { commitFiles } from './helpers/seed';
import { schema } from '../db/schema';
import {
  deliverNotificationEmails,
  pruneNotifications,
} from '../lib/notification-email';

const base = '/api/repos/octocat/app';

type Row = {
  id: string;
  unread: boolean;
  reason: string;
  event: string;
  actor: { username: string } | null;
  excerpt: string | null;
  repository: string;
  subject: { kind: string; number: number; title: string; state: string };
  url: string;
};

async function world(visibility: 'internal' | 'private' = 'internal') {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  expect(
    (
      await call(t, '/api/repos', {
        cookie: admin,
        json: { name: 'app', addReadme: true, visibility },
      })
    ).status
  ).toBe(201);
  const bob = await addMember(t, admin, 'bob');
  const carol = await addMember(t, admin, 'carol');
  // Every account's email is confirmed, so emails are owed where the choice allows.
  await t.env.DB.prepare('UPDATE users SET email_verified = 1').run();
  const repo = [...t.fake.repos.values()][0];
  return { t, admin, bob, carol, repo };
}

async function inbox(t: TestEnv, cookie: string, query = '') {
  const res = await call(t, `/api/notifications${query}`, { cookie });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    notifications: Row[];
    unread: number;
    total: number;
  };
}

const openIssue = async (
  t: TestEnv,
  cookie: string,
  json: Record<string, unknown>
) =>
  (
    (await (await call(t, `${base}/issues`, { cookie, json })).json()) as {
      number: number;
    }
  ).number;

const comment = (t: TestEnv, cookie: string, n: number, body: string) =>
  call(t, `${base}/issues/${n}/comments`, { cookie, json: { body } });

describe('通知：谁会收到', () => {
  it('通知候选跟随即时仓库读取权限，封禁与Agent不因公开或管理员身份收信', async () => {
    const { t, admin } = await world('private');
    const db = drizzle(t.env.DB, { schema });
    const people = await db.select().from(users).all();
    const bob = people.find((person) => person.username === 'bob')!;
    const carol = people.find((person) => person.username === 'carol')!;
    const owner = people.find((person) => person.username === 'octocat')!;
    const blocked = {
      ...carol,
      id: crypto.randomUUID(),
      username: 'blocked',
      email: 'blocked@example.com',
      role: 'admin',
      banned: true,
    };
    const agent = {
      ...carol,
      id: crypto.randomUUID(),
      username: 'reviewer',
      email: 'reviewer@agent.invalid',
      role: 'admin',
    };
    await db.insert(users).values([blocked, agent]);
    await db.insert(agents).values({
      userId: agent.id,
      name: 'Reviewer',
      triggerAsk: 'Review?',
      triggerAbove: 0.5,
      createdAt: new Date(),
    });
    expect(
      (
        await call(t, `${base}/collaborators/bob`, {
          cookie: admin,
          method: 'PUT',
        })
      ).status
    ).toBe(200);
    let repo = (await db.select().from(repositories).get())!;
    const ids = [owner.id, bob.id, carol.id, blocked.id, agent.id, 'missing'];
    const candidates = async () => readersAmong(db, repo, ids);
    const first = await candidates();
    expect(
      [...first]
        .filter(([, person]) => person.read)
        .map(([id]) => id)
        .sort()
    ).toEqual([owner.id, bob.id].sort());
    expect(first.has('missing')).toBe(false);
    await db
      .delete(repositoryCollaborators)
      .where(eq(repositoryCollaborators.userId, bob.id));
    expect((await candidates()).get(bob.id)?.read).toBe(false);
    await db
      .update(repositories)
      .set({ visibility: 'public' })
      .where(eq(repositories.id, repo.id));
    repo = (await db.select().from(repositories).get())!;
    const published = await candidates();
    expect(published.get(carol.id)?.read).toBe(true);
    expect(published.get(blocked.id)?.read).toBe(false);
    expect(published.get(agent.id)?.read).toBe(false);
    await db
      .update(repositories)
      .set({ visibility: 'private' })
      .where(eq(repositories.id, repo.id));
    repo = (await db.select().from(repositories).get())!;
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, bob.id));
    expect((await candidates()).get(bob.id)?.read).toBe(true);
    await db.update(users).set({ banned: true }).where(eq(users.id, bob.id));
    expect((await candidates()).get(bob.id)?.read).toBe(false);
  });

  it('作者和参与者收到评论；@ 提及的人收到并订阅；行动者自己不收到', async () => {
    const { t, admin, bob, carol } = await world();
    const n = await openIssue(t, admin, { title: 'Crash', body: 'It breaks' });
    // Nobody follows a new issue yet but its author.
    expect((await inbox(t, bob)).total).toBe(0);

    await comment(t, bob, n, 'Same for me');
    const a = await inbox(t, admin);
    expect(a.notifications).toMatchObject([
      {
        reason: 'author',
        event: 'commented',
        actor: { username: 'bob' },
        excerpt: 'Same for me',
        repository: 'octocat/app',
        subject: { kind: 'issue', number: n, title: 'Crash', state: 'open' },
        url: `/octocat/app/issues/${n}`,
      },
    ]);
    expect((await inbox(t, bob)).total).toBe(0);

    await comment(t, admin, n, 'Thanks. @carol can you look? `@bob` is code');
    expect((await inbox(t, bob)).notifications).toMatchObject([
      { reason: 'participating', event: 'commented' },
    ]);
    expect((await inbox(t, carol)).notifications).toMatchObject([
      { reason: 'mention', event: 'commented', actor: { username: 'octocat' } },
    ]);
    // Carol follows it now: the next comment reaches her as a participant.
    await comment(t, bob, n, 'Found it');
    expect((await inbox(t, carol)).notifications[0]).toMatchObject({
      reason: 'participating',
      actor: { username: 'bob' },
    });
    // One row per thread: still one notification each.
    expect((await inbox(t, admin)).total).toBe(1);
  });

  it('关注仓库收到新建，忽略仓库连提及也不收到；取消订阅后只有被点名才收到', async () => {
    const { t, admin, bob, carol } = await world();
    const watch = (cookie: string, level: string) =>
      call(t, `${base}/watch`, { cookie, method: 'PUT', json: { level } });
    expect((await watch(bob, 'watching')).status).toBe(200);
    expect((await watch(carol, 'ignoring')).status).toBe(200);
    const level = (await (
      await call(t, `${base}/watch`, { cookie: bob })
    ).json()) as { level: string; watchers: number };
    expect(level).toEqual({ level: 'watching', watchers: 1 });

    const n = await openIssue(t, admin, {
      title: 'Plan',
      body: 'cc @carol',
    });
    expect((await inbox(t, bob)).notifications).toMatchObject([
      { reason: 'watching', event: 'opened' },
    ]);
    expect((await inbox(t, carol)).total).toBe(0);

    // Bob unsubscribes from this issue: watching no longer brings it, a mention does.
    expect(
      (
        await call(t, `${base}/issues/${n}/subscription`, {
          cookie: bob,
          method: 'PUT',
          json: { subscribed: false },
        })
      ).status
    ).toBe(200);
    await call(t, '/api/notifications/read', {
      cookie: bob,
      json: { all: true },
    });
    await comment(t, admin, n, 'quiet');
    expect((await inbox(t, bob)).total).toBe(0);
    await comment(t, admin, n, '@bob one more thing');
    expect((await inbox(t, bob)).notifications).toMatchObject([
      { reason: 'mention' },
    ]);
    const sub = (await (
      await call(t, `${base}/issues/${n}/subscription`, { cookie: bob })
    ).json()) as { subscribed: boolean; reason: string };
    expect(sub).toEqual({ subscribed: true, reason: 'mention' });
  });

  it('私有仓库里提及看不到它的人不会通知他；失去权限后收件箱不再显示', async () => {
    const { t, admin, bob, carol } = await world('private');
    await call(t, `${base}/collaborators/bob`, {
      cookie: admin,
      method: 'PUT',
    });
    const n = await openIssue(t, admin, { title: 'Secret', body: '' });
    await comment(t, admin, n, '@bob and @carol, thoughts?');
    expect((await inbox(t, carol)).total).toBe(0);
    const rows = await t.env.DB.prepare(
      "SELECT user_id FROM notification_subscriptions WHERE reason = 'mention'"
    ).all<{ user_id: string }>();
    expect(rows.results).toHaveLength(1);
    expect((await inbox(t, bob)).unread).toBe(1);

    await call(t, `${base}/collaborators/bob`, {
      cookie: admin,
      method: 'DELETE',
    });
    expect(await inbox(t, bob)).toMatchObject({ total: 0, unread: 0 });
    expect(
      (
        (await (
          await call(t, '/api/notifications/count', { cookie: bob })
        ).json()) as { unread: number }
      ).unread
    ).toBe(0);
  });

  it('被指派的人收到通知；关闭和重新打开通知订阅者', async () => {
    const { t, admin, bob } = await world();
    await call(t, `${base}/collaborators/bob`, {
      cookie: admin,
      method: 'PUT',
    });
    const n = await openIssue(t, admin, { title: 'Do it' });
    await call(t, `${base}/issues/${n}`, {
      cookie: admin,
      method: 'PATCH',
      json: { assignees: ['bob'] },
    });
    expect((await inbox(t, bob)).notifications).toMatchObject([
      { reason: 'assign', event: 'assigned' },
    ]);
    await call(t, `${base}/issues/${n}`, {
      cookie: admin,
      method: 'PATCH',
      json: { state: 'closed' },
    });
    expect((await inbox(t, bob)).notifications[0]).toMatchObject({
      reason: 'assign',
      event: 'closed',
      subject: { state: 'closed' },
    });
  });

  it('拉取请求：新建时提及、评论与合并都通知参与者', async () => {
    const { t, admin, bob, carol, repo } = await world();
    await commitFiles(repo, 'feature', { 'a.txt': 'a' }, 'feat', [
      repo.refs.get('refs/heads/main')!,
    ]);
    const pr = (await (
      await call(t, `${base}/pulls`, {
        cookie: admin,
        json: {
          title: 'Fix',
          body: 'Review please, @bob',
          base: 'main',
          head: 'feature',
        },
      })
    ).json()) as { number: number };
    expect((await inbox(t, bob)).notifications).toMatchObject([
      {
        reason: 'mention',
        event: 'opened',
        subject: { kind: 'pull', number: pr.number },
        url: `/octocat/app/pull/${pr.number}`,
      },
    ]);
    await call(t, `${base}/pulls/${pr.number}/comments`, {
      cookie: carol,
      json: { body: 'Looks fine' },
    });
    expect((await inbox(t, admin)).notifications[0]).toMatchObject({
      reason: 'author',
      event: 'commented',
      actor: { username: 'carol' },
    });
    expect(
      (
        await call(t, `${base}/pulls/${pr.number}/merge`, {
          cookie: admin,
          json: { approve: true },
        })
      ).status
    ).toBe(200);
    await settle(t);
    for (const cookie of [bob, carol])
      expect((await inbox(t, cookie)).notifications[0]).toMatchObject({
        event: 'merged',
        actor: { username: 'octocat' },
        subject: { state: 'merged' },
      });
  });
});

describe('通知：收件箱', () => {
  it('标为已读、未读、全部已读与完成', async () => {
    const { t, admin, bob } = await world();
    const ids: string[] = [];
    for (const title of ['One', 'Two']) {
      const n = await openIssue(t, admin, { title });
      await comment(t, bob, n, 'me too');
    }
    const all = await inbox(t, admin);
    expect(all.notifications.map((r) => r.subject.title)).toEqual([
      'Two',
      'One',
    ]);
    ids.push(...all.notifications.map((r) => r.id));
    expect(
      (
        await call(t, '/api/notifications/read', {
          cookie: admin,
          json: { ids: [ids[0]] },
        })
      ).status
    ).toBe(200);
    expect(await inbox(t, admin)).toMatchObject({ total: 1, unread: 1 });
    expect((await inbox(t, admin, '?filter=all')).total).toBe(2);
    await call(t, `/api/notifications/${ids[0]}`, {
      cookie: admin,
      method: 'PATCH',
      json: { unread: true },
    });
    expect((await inbox(t, admin)).unread).toBe(2);
    // Someone else's notification is not found.
    expect(
      (
        await call(t, `/api/notifications/${ids[0]}`, {
          cookie: bob,
          method: 'DELETE',
        })
      ).status
    ).toBe(404);
    await call(t, '/api/notifications/read', {
      cookie: admin,
      json: { all: true, repo: 'octocat/app' },
    });
    expect((await inbox(t, admin)).unread).toBe(0);
    await call(t, `/api/notifications/${ids[1]}`, {
      cookie: admin,
      method: 'DELETE',
    });
    expect((await inbox(t, admin, '?filter=all')).total).toBe(1);
    expect(
      (
        await call(t, '/api/notifications/read', {
          cookie: admin,
          json: {},
        })
      ).status
    ).toBe(400);
  });

  it('每日任务删除过期的通知', async () => {
    const { t, admin, bob } = await world();
    const n = await openIssue(t, admin, { title: 'Old' });
    await comment(t, bob, n, 'hello');
    const db = drizzle(t.env.DB, { schema });
    const day = 86_400_000;
    await pruneNotifications(db, Date.now() + 100 * day);
    expect((await inbox(t, admin)).total).toBe(1);
    await call(t, '/api/notifications/read', {
      cookie: admin,
      json: { all: true },
    });
    await pruneNotifications(db, Date.now() + 100 * day);
    expect((await inbox(t, admin, '?filter=all')).total).toBe(0);
  });
});

/** Notification emails sent to `to` (invitations go out too). */
const notes = (t: TestEnv, to: string) =>
  t.sent.filter((m) => m.to === to && m.subject.startsWith('[octocat/app]'));

describe('通知：邮件', () => {
  it.each([
    'remove-collaborator',
    'ban',
    'make-private',
    'email-off',
    'ignore',
    'unsubscribe',
  ])('发送待发邮件前重新检查当前收件资格：%s', async (change) => {
    const { t, admin, bob } = await world(
      change === 'make-private' ? 'internal' : 'private'
    );
    if (change !== 'make-private')
      expect(
        (
          await call(t, `${base}/collaborators/bob`, {
            cookie: admin,
            method: 'PUT',
          })
        ).status
      ).toBe(200);
    const n = await openIssue(t, admin, {
      title: 'Original title',
      body: '@bob',
    });
    await settle(t);
    // A persisted outbox row left by a stopped Worker, before the delivery claim.
    await t.env.DB.prepare(
      "UPDATE notifications SET email_pending_at = ? WHERE user_id = (SELECT id FROM users WHERE username = 'bob')"
    )
      .bind(Date.now())
      .run();
    t.sent.length = 0;
    if (change === 'remove-collaborator') {
      expect(
        (
          await call(t, `${base}/collaborators/bob`, {
            cookie: admin,
            method: 'DELETE',
          })
        ).status
      ).toBe(200);
    } else if (change === 'ban') {
      await t.env.DB.prepare(
        "UPDATE users SET banned = 1 WHERE username = 'bob'"
      ).run();
    } else if (change === 'make-private') {
      expect(
        (
          await call(t, base, {
            cookie: admin,
            method: 'PATCH',
            json: { visibility: 'private' },
          })
        ).status
      ).toBe(200);
    } else if (change === 'email-off') {
      expect(
        (
          await call(t, '/api/me/preferences', {
            cookie: bob,
            method: 'PUT',
            json: { notificationEmail: 'off' },
          })
        ).status
      ).toBe(200);
    } else if (change === 'ignore') {
      expect(
        (
          await call(t, `${base}/watch`, {
            cookie: bob,
            method: 'PUT',
            json: { level: 'ignoring' },
          })
        ).status
      ).toBe(200);
    } else {
      expect(
        (
          await call(t, `${base}/issues/${n}/subscription`, {
            cookie: bob,
            method: 'PUT',
            json: { subscribed: false },
          })
        ).status
      ).toBe(200);
    }
    expect(
      (
        await call(t, `${base}/issues/${n}`, {
          cookie: admin,
          method: 'PATCH',
          json: { title: 'New confidential title after revocation' },
        })
      ).status
    ).toBe(200);
    expect(
      await deliverNotificationEmails(t.env, drizzle(t.env.DB, { schema }))
    ).toBe(0);
    expect(notes(t, 'bob@example.com')).toEqual([]);
    expect(
      (
        await t.env.DB.prepare(
          'SELECT count(*) AS n FROM notifications WHERE email_pending_at IS NOT NULL'
        ).first<{ n: number }>()
      )?.n
    ).toBe(0);
  });

  it('默认只为与自己直接相关的动静发邮件，可改为全部或关闭，每条只发一次', async () => {
    const { t, admin, bob, carol } = await world();
    await call(t, `${base}/watch`, {
      cookie: carol,
      method: 'PUT',
      json: { level: 'watching' },
    });
    const n = await openIssue(t, admin, { title: 'Mail me' });
    await settle(t);
    // Carol only watches: no email by default.
    expect(notes(t, 'carol@example.com')).toEqual([]);

    await comment(t, bob, n, 'A comment that the author should read');
    await settle(t);
    const toAdmin = notes(t, 'octocat@example.com');
    expect(toAdmin).toHaveLength(1);
    expect(toAdmin[0].subject).toBe(`[octocat/app] Mail me (#${n})`);
    expect(toAdmin[0].text).toContain('bob commented');
    expect(toAdmin[0].text).toContain('A comment that the author should read');
    expect(toAdmin[0].text).toContain(
      `http://test.local/octocat/app/issues/${n}`
    );

    // Carol asks for everything; the author turns email off.
    await call(t, '/api/me/preferences', {
      cookie: carol,
      method: 'PUT',
      json: { notificationEmail: 'all' },
    });
    await call(t, '/api/me/preferences', {
      cookie: admin,
      method: 'PUT',
      json: { notificationEmail: 'off' },
    });
    await comment(t, bob, n, 'second');
    await settle(t);
    expect(notes(t, 'carol@example.com')).toHaveLength(1);
    expect(notes(t, 'octocat@example.com')).toHaveLength(1);
    const pending = await t.env.DB.prepare(
      'SELECT count(*) AS n FROM notifications WHERE email_pending_at IS NOT NULL'
    ).first<{ n: number }>();
    expect(pending?.n).toBe(0);
  });
});
