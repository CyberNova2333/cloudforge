import { afterEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { addMember, call, settle, type TestEnv } from './helpers/app';
import { setup, pushFiles } from './helpers/actions';
import { commitFiles } from './helpers/seed';
import { schema } from '../db/schema';
import {
  deliverDueWebhooks,
  enqueueDeliveries,
  signature,
  webhookUrlError,
} from '../lib/webhooks';

const base = '/api/repos/octocat/app';
const HOOK_URL = 'https://hooks.example.com/cloudforge';

type Sent = { url: string; headers: Record<string, string>; body: string };

/** Answers webhook requests with `status`, recording them; other requests (the git fake) go through. */
function receiver(status: number | (() => number) = 200) {
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!url.startsWith('https://hooks.example.com/')) return real(input, init);
    sent.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: String(init?.body),
    });
    return new Response('thanks', {
      status: typeof status === 'function' ? status() : status,
    });
  });
  return sent;
}

afterEach(() => vi.restoreAllMocks());

const events = (sent: Sent[]) =>
  sent.map((s) => {
    const body = JSON.parse(s.body) as { action?: string };
    return [s.headers['x-cloudforge-event'], body.action ?? null];
  });

async function addHook(
  t: TestEnv,
  cookie: string,
  json: Record<string, unknown>
) {
  const res = await call(t, `${base}/hooks`, { cookie, json });
  return {
    status: res.status,
    body: (await res.json()) as {
      id: string;
      hasSecret: boolean;
      error?: string;
    },
  };
}

describe('Webhook 地址与签名', () => {
  it('只接受公网的 http/https 地址，不接受实例自己', () => {
    expect(webhookUrlError('https://ci.example.com/hook')).toBeNull();
    expect(webhookUrlError('http://ci.example.com:8080/x')).toBeNull();
    for (const bad of [
      'ftp://ci.example.com',
      'https://user:pw@ci.example.com',
      'http://localhost:3000',
      'http://api.internal/x',
      'http://printer.local',
      'http://10.0.0.5/x',
      'http://172.20.1.1',
      'http://192.168.1.10',
      'http://127.0.0.1',
      'http://169.254.169.254/latest',
      'http://[::1]/x',
      'http://[fd00::1]/x',
      'http://intranet/x',
      'not a url',
    ])
      expect(webhookUrlError(bad), bad).not.toBeNull();
    expect(
      webhookUrlError('https://git.example.com/x', 'https://git.example.com')
    ).not.toBeNull();
  });

  it('签名与 GitHub 的 X-Hub-Signature-256 一致', async () => {
    // GitHub's documented example.
    expect(await signature("It's a Secret to Everybody", 'Hello, World!')).toBe(
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17'
    );
  });
});

describe('Webhooks', () => {
  it('仓库管理员新建后立即 ping，请求带签名；密钥不再显示；其他人不能管理', async () => {
    const s = await setup();
    const sent = receiver();
    const bob = await addMember(s.t, s.admin, 'bob');
    expect((await addHook(s.t, bob, { url: HOOK_URL })).status).toBe(403);
    expect(
      (await addHook(s.t, s.admin, { url: 'http://10.1.2.3/x' })).status
    ).toBe(422);
    const created = await addHook(s.t, s.admin, {
      url: HOOK_URL,
      secret: 's3cret',
      events: ['issues', 'push'],
    });
    expect(created.status).toBe(201);
    expect(created.body.hasSecret).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain('s3cret');
    await settle(s.t);
    expect(sent).toHaveLength(1);
    const ping = sent[0];
    expect(ping.headers).toMatchObject({
      'content-type': 'application/json',
      'x-cloudforge-event': 'ping',
      'x-github-event': 'ping',
      'x-cloudforge-hook-id': created.body.id,
    });
    expect(ping.headers['x-hub-signature-256']).toBe(
      await signature('s3cret', ping.body)
    );
    expect(JSON.parse(ping.body)).toMatchObject({
      hook_id: created.body.id,
      repository: { full_name: 'octocat/app' },
      sender: { login: 'octocat' },
    });

    const detail = (await (
      await call(s.t, `${base}/hooks/${created.body.id}`, { cookie: s.admin })
    ).json()) as {
      lastStatus: number;
      deliveries: {
        event: string;
        status: string;
        responseStatus: number;
        responseBody: string;
      }[];
    };
    expect(detail.lastStatus).toBe(200);
    expect(detail.deliveries).toMatchObject([
      {
        event: 'ping',
        status: 'delivered',
        responseStatus: 200,
        responseBody: 'thanks',
      },
    ]);
    const audit = await s.t.env.DB.prepare(
      "SELECT action, target FROM audit_events WHERE action LIKE 'webhook.%'"
    ).all<{ action: string; target: string }>();
    expect(audit.results).toEqual([
      { action: 'webhook.created', target: 'hooks.example.com' },
    ]);
  });

  it('议题、评论、拉取请求、合并、推送与提交状态各自送达订阅了它们的 webhook', async () => {
    const s = await setup();
    const sent = receiver();
    await addHook(s.t, s.admin, { url: HOOK_URL, events: ['*'] });
    await settle(s.t);
    sent.length = 0;

    const issue = (await (
      await call(s.t, `${base}/issues`, {
        cookie: s.admin,
        json: { title: 'Bug' },
      })
    ).json()) as { number: number };
    await call(s.t, `${base}/issues/${issue.number}/comments`, {
      cookie: s.admin,
      json: { body: 'More detail' },
    });
    const head = await commitFiles(
      s.repo,
      'feature',
      { 'a.txt': 'a' },
      'feat',
      [s.repo.refs.get('refs/heads/main')!]
    );
    const pr = (await (
      await call(s.t, `${base}/pulls`, {
        cookie: s.admin,
        json: {
          title: 'Fix',
          body: `Fixes #${issue.number}`,
          base: 'main',
          head: 'feature',
        },
      })
    ).json()) as { number: number };
    await call(s.t, `${base}/statuses/${head}`, {
      cookie: s.admin,
      json: { state: 'success', context: 'ci' },
    });
    await call(s.t, `${base}/pulls/${pr.number}/merge`, {
      cookie: s.admin,
      json: { approve: true },
    });
    await settle(s.t);
    expect(events(sent)).toEqual([
      ['issues', 'opened'],
      ['issue_comment', 'created'],
      ['pull_request', 'opened'],
      ['status', null],
      ['issues', 'closed'],
      ['pull_request', 'closed'],
      ['push', null],
    ]);
    const merged = JSON.parse(sent[5].body);
    expect(merged.pull_request).toMatchObject({
      number: pr.number,
      merged: true,
      state: 'closed',
      head: { ref: 'feature' },
      base: { ref: 'main' },
    });
    const pushed = JSON.parse(sent[6].body);
    expect(pushed).toMatchObject({
      ref: 'refs/heads/main',
      created: false,
      deleted: false,
      head_commit: { message: 'feat' },
    });
    expect(JSON.parse(sent[1].body)).toMatchObject({
      issue: { number: issue.number },
      comment: { body: 'More detail', user: { login: 'octocat' } },
    });
  });

  it('git 推送送出 push 和 synchronize，同一推送事件重跑不重复投递', async () => {
    const s = await setup();
    const sent = receiver();
    await addHook(s.t, s.admin, {
      url: HOOK_URL,
      events: ['push', 'pull_request'],
    });
    await pushFiles(s, 'topic', { 'x.txt': '1' });
    await call(s.t, `${base}/pulls`, {
      cookie: s.admin,
      json: { title: 'Topic', base: 'main', head: 'topic' },
    });
    await settle(s.t);
    sent.length = 0;
    await pushFiles(s, 'topic', { 'x.txt': '2' });
    await settle(s.t);
    expect(events(sent)).toEqual([
      ['push', null],
      ['pull_request', 'synchronize'],
    ]);
    expect(JSON.parse(sent[0].body)).toMatchObject({
      ref: 'refs/heads/topic',
      created: false,
    });
    // Run the push event's follow-ups again: their deliveries exist already.
    const db = drizzle(s.t.env.DB, { schema });
    const ev = (await s.t.env.DB.prepare(
      'SELECT id FROM push_events ORDER BY created_at DESC LIMIT 1'
    ).first<{ id: string }>())!;
    const rows = await s.t.env.DB.prepare(
      "SELECT count(*) AS n FROM webhook_deliveries WHERE id LIKE 'push:' || ? || '%'"
    )
      .bind(ev.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
    const hooks = await db.query.webhooks.findMany();
    expect(
      await enqueueDeliveries(
        { env: s.t.env, db },
        hooks,
        'push',
        null,
        {},
        `push:${ev.id}:refs/heads/topic`
      )
    ).toEqual([]);
  });

  it('失败后按退避重试，五次后放弃；可以重新投递；不跟随重定向', async () => {
    const s = await setup();
    let status = 500;
    const sent = receiver(() => status);
    const hook = await addHook(s.t, s.admin, {
      url: HOOK_URL,
      events: ['issues'],
    });
    await settle(s.t);
    const db = drizzle(s.t.env.DB, { schema });
    const ping = () =>
      s.t.env.DB.prepare(
        "SELECT status, attempts, next_attempt_at FROM webhook_deliveries WHERE event = 'ping'"
      ).first<{
        status: string;
        attempts: number;
        next_attempt_at: number | null;
      }>();
    let row = (await ping())!;
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row.next_attempt_at! - Date.now()).toBeGreaterThan(50_000);
    // Not due yet: nothing is sent.
    expect(await deliverDueWebhooks(s.t.env, db)).toBe(0);
    expect(sent).toHaveLength(1);
    let now = Date.now();
    for (let i = 0; i < 4; i++) {
      now += 3 * 3_600_000;
      await deliverDueWebhooks(s.t.env, db, { now });
    }
    row = (await ping())!;
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 5,
      next_attempt_at: null,
    });
    expect(sent).toHaveLength(5);

    // A redirect is a failure.
    status = 302;
    const id = (await s.t.env.DB.prepare(
      "SELECT id FROM webhook_deliveries WHERE event = 'ping'"
    ).first<{ id: string }>())!.id;
    const again = await call(
      s.t,
      `${base}/hooks/${hook.body.id}/deliveries/${id}/redeliver`,
      { cookie: s.admin, method: 'POST' }
    );
    expect(again.status).toBe(200);
    await settle(s.t);
    const redelivered = (await s.t.env.DB.prepare(
      "SELECT error, status FROM webhook_deliveries WHERE event = 'ping' AND id != ?"
    )
      .bind(id)
      .first<{ error: string; status: string }>())!;
    expect(redelivered).toMatchObject({
      status: 'pending',
      error: 'Redirects are not followed',
    });
    status = 200;
    expect(
      (
        await call(s.t, `${base}/hooks/${hook.body.id}/pings`, {
          cookie: s.admin,
          method: 'POST',
        })
      ).status
    ).toBe(200);
    await settle(s.t);
    expect(sent.at(-1)?.headers['x-cloudforge-event']).toBe('ping');

    // Deliveries are kept two weeks.
    await deliverDueWebhooks(s.t.env, db, {
      now: Date.now() + 15 * 86_400_000,
    });
    expect(
      (
        await s.t.env.DB.prepare(
          'SELECT count(*) AS n FROM webhook_deliveries'
        ).first<{ n: number }>()
      )?.n
    ).toBe(0);
  });

  it('停用、修改事件与删除', async () => {
    const s = await setup();
    const sent = receiver();
    const hook = await addHook(s.t, s.admin, {
      url: HOOK_URL,
      events: ['issues'],
      active: false,
    });
    await call(s.t, `${base}/issues`, {
      cookie: s.admin,
      json: { title: 'Quiet' },
    });
    await settle(s.t);
    expect(sent).toHaveLength(0);
    const patched = await call(s.t, `${base}/hooks/${hook.body.id}`, {
      cookie: s.admin,
      method: 'PATCH',
      json: { active: true, events: ['issue_comment'], secret: 'new' },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      active: true,
      events: ['issue_comment'],
      hasSecret: true,
    });
    await call(s.t, `${base}/issues`, {
      cookie: s.admin,
      json: { title: 'Still quiet' },
    });
    await settle(s.t);
    expect(sent).toHaveLength(0);
    expect(
      (
        await call(s.t, `${base}/hooks/${hook.body.id}`, {
          cookie: s.admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(200);
    expect(
      (await call(s.t, `${base}/hooks`, { cookie: s.admin }).then((r) =>
        r.json()
      )) as unknown[]
    ).toEqual([]);
    const audit = await s.t.env.DB.prepare(
      "SELECT action FROM audit_events WHERE action LIKE 'webhook.%' ORDER BY created_at"
    ).all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual([
      'webhook.created',
      'webhook.updated',
      'webhook.deleted',
    ]);
  });
});
