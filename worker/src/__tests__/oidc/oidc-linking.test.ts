import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';
import { providerFrom } from '../../oidc/provider';
import * as oidc from '../../oidc/service';

let key: Awaited<ReturnType<typeof generateKeyPair>>, jwk: JWK;
beforeAll(async () => {
  key = await generateKeyPair('ES256');
  jwk = {
    ...(await exportJWK(key.publicKey)),
    kid: 'linking-test',
    alg: 'ES256',
    use: 'sig',
  };
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const me = '/api/me/oidc',
  admin = '/api/admin/oidc-provider';
const cookies = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
async function planOf(response: Response) {
  const { previewId, digest } = (await response.json()) as {
    previewId: string;
    digest: string;
  };
  return { previewId, digest };
}
async function identity(t: TestEnv, cookie: string) {
  return (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { session: { id: string }; user: { id: string } };
}
async function post(t: TestEnv, cookie: string, path: string, json: unknown) {
  const active = await identity(t, cookie);
  return call(t, path, {
    cookie,
    json,
    headers: { 'X-CloudForge-Session': active.session.id },
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
function cookieJar(initial: string) {
  const values = new Map(
    initial
      .split('; ')
      .filter(Boolean)
      .map((v) => {
        const at = v.indexOf('=');
        return [v.slice(0, at), v.slice(at + 1)] as const;
      })
  );
  return {
    apply(response: Response) {
      for (const h of response.headers.getSetCookie()) {
        const first = h.split(';')[0],
          at = first.indexOf('='),
          name = first.slice(0, at),
          value = first.slice(at + 1);
        if (!value || /max-age=0(?:;|$)/i.test(h)) values.delete(name);
        else values.set(name, value);
      }
    },
    header: () => [...values].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}
async function fixture() {
  const t = makeEnv(),
    issuer = 'https://identity.example/' + crypto.randomUUID();
  const description = {
    id: 'company',
    name: 'Company identity',
    issuer,
    clientId: 'cloudforge-client',
    version: 1,
  };
  Object.assign(t.env, {
    OIDC_PROVIDER: JSON.stringify(description),
    OIDC_CLIENT_SECRET: 'local-client-secret-not-returned',
  });
  const cookie = await bootstrapAdmin(t),
    owner = await identity(t, cookie);
  const codes = new Map<
    string,
    { nonce: string; subject: string; email?: string }
  >();
  let exchanges = 0,
    hold: (() => Promise<void>) | null = null,
    discoveryHold: (() => Promise<void>) | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === issuer + '/.well-known/openid-configuration') {
        if (discoveryHold) await discoveryHold();
        return Response.json({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          jwks_uri: issuer + '/jwks',
          id_token_signing_alg_values_supported: ['ES256'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url === issuer + '/jwks') return Response.json({ keys: [jwk] });
      if (url === issuer + '/token') {
        exchanges++;
        if (hold) await hold();
        const code = new URLSearchParams(String(init?.body)).get('code')!,
          data = codes.get(code);
        if (!data)
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        const now = Math.floor(Date.now() / 1000);
        const token = await new SignJWT({
          iss: issuer,
          aud: description.clientId,
          sub: data.subject,
          nonce: data.nonce,
          iat: now,
          exp: now + 300,
          email: data.email ?? 'external@example.invalid',
          name: 'External identity',
        })
          .setProtectedHeader({ alg: 'ES256', kid: 'linking-test' })
          .sign(key.privateKey);
        return Response.json({
          id_token: token,
          access_token: 'must-not-be-stored',
          refresh_token: 'must-not-be-stored-either',
        });
      }
      throw new Error('Unexpected fixture network call');
    })
  );
  return {
    t,
    cookie,
    owner,
    issuer,
    description,
    codes,
    exchanges: () => exchanges,
    hold: (callback: (() => Promise<void>) | null) => {
      hold = callback;
    },
    holdDiscovery: (callback: (() => Promise<void>) | null) => {
      discoveryHold = callback;
    },
  };
}
async function publish(
  f: Awaited<ReturnType<typeof fixture>>,
  t = f.t,
  cookie = f.cookie
) {
  const p = await post(t, cookie, admin + '/preview', {});
  expect(p.status, await p.clone().text()).toBe(200);
  const plan = await planOf(p);
  const result = await post(t, cookie, admin + '/apply', plan);
  expect(result.status, await result.clone().text()).toBe(200);
  return plan;
}
async function retire(f: Awaited<ReturnType<typeof fixture>>, t = f.t) {
  const preview = await post(t, f.cookie, admin + '/retire-preview', {});
  expect(preview.status, await preview.clone().text()).toBe(200);
  const plan = await planOf(preview),
    result = await post(t, f.cookie, admin + '/retire', plan);
  expect(result.status, await result.clone().text()).toBe(200);
  return plan;
}
async function pending(
  f: Awaited<ReturnType<typeof fixture>>,
  cookie = f.cookie,
  subject = 'external-subject'
) {
  const response = await post(f.t, cookie, me + '/preview', {});
  expect(response.status, await response.clone().text()).toBe(200);
  const plan = await planOf(response);
  const started = await post(f.t, cookie, me + '/start', plan);
  expect(started.status, await started.clone().text()).toBe(200);
  const url = new URL(
    ((await started.json()) as { authorizationUrl: string }).authorizationUrl
  );
  const code = crypto.randomUUID();
  f.codes.set(code, { nonce: url.searchParams.get('nonce')!, subject });
  const callbackPath =
    new URL(url.searchParams.get('redirect_uri')!).pathname +
    '?' +
    new URLSearchParams({ state: url.searchParams.get('state')!, code });
  const allCookies = [cookie, cookies(started)].join('; ');
  return {
    plan,
    started,
    url,
    callbackPath,
    allCookies,
    callback: () => call(f.t, callbackPath, { cookie: allCookies }),
  };
}
async function candidate(
  f: Awaited<ReturnType<typeof fixture>>,
  cookie = f.cookie,
  subject = 'external-subject'
) {
  const a = await pending(f, cookie, subject),
    r = await a.callback();
  expect(r.status, await r.clone().text()).toBe(302);
  expect(
    new URL(r.headers.get('location')!, 'http://test.local').searchParams.get(
      'oidc_status'
    )
  ).toBe('candidate');
  return a;
}
async function binding(
  f: Awaited<ReturnType<typeof fixture>>,
  cookie = f.cookie,
  subject = 'external-subject'
) {
  const a = await candidate(f, cookie, subject),
    r = await post(f.t, cookie, me + '/confirm', {
      actionId: a.plan.previewId,
    });
  expect(r.status, await r.clone().text()).toBe(200);
  return {
    a,
    binding: ((await r.json()) as { binding: oidc.BindingDTO }).binding,
  };
}

describe('显式OIDC绑定的真实D1状态机', () => {
  it('停用写失效摘要拒绝旧digest匹配，数据库确认触发器独立拒绝停用后的迟到写', async () => {
    const f = await fixture();
    await publish(f);
    const a = await candidate(f),
      deployed = (await providerFrom(f.t.env))!;
    await retire(f);
    const current = (await oidc.currentConfiguration(f.t.env))!;
    expect(current.digest).toMatch(/^retired:/);
    expect(current.digest).not.toBe(deployed.digest);
    expect(
      await f.t.env.DB.prepare(
        'SELECT digest,version FROM oidc_providers WHERE id=?'
      )
        .bind('company')
        .first()
    ).toEqual({ digest: deployed.digest, version: 1 });
    // Model an older caller that knows the digest/generation contract but not the new enabled field.
    // The D1 confirmation boundary itself must reject a relabelled late candidate.
    await f.t.env.DB.prepare(
      "UPDATE oidc_link_actions SET status='candidate',subject='late-subject',configuration_generation=?,provider_digest=? WHERE id=?"
    )
      .bind(current.generation, current.digest, a.plan.previewId)
      .run();
    await expect(
      f.t.env.DB.prepare(
        "UPDATE oidc_link_actions SET status='confirmed',binding_id=?,completed_at=? WHERE id=?"
      )
        .bind(crypto.randomUUID(), Date.now(), a.plan.previewId)
        .run()
    ).rejects.toThrow('OIDC configuration changed');
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM oidc_bindings'
      ).first()
    ).toEqual({ n: 0 });
    expect(
      await f.t.env.DB.prepare(
        'SELECT status FROM oidc_link_actions WHERE id=?'
      )
        .bind(a.plan.previewId)
        .first()
    ).toEqual({ status: 'candidate' });
  });
  it('停用取消已有候选和悬挂的交换，迟到旧Worker响应不能再写入身份', async () => {
    const f = await fixture(),
      other = await addMember(f.t, f.cookie, 'other');
    await publish(f);
    const candidateOther = await candidate(f, other, 'other-subject'),
      old = await pending(f),
      entered = deferred(),
      resume = deferred();
    f.hold(async () => {
      entered.resolve();
      await resume.promise;
    });
    const inFlight = old.callback();
    await entered.promise;
    const broken = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: '{broken-json',
        OIDC_CLIENT_SECRET: '',
      } as unknown as CloudflareBindings,
    };
    await retire(f, broken);
    resume.resolve();
    expect((await inFlight).status).toBe(302);
    expect(
      (
        await post(f.t, other, me + '/confirm', {
          actionId: candidateOther.plan.previewId,
        })
      ).status
    ).toBe(409);
    expect(
      await f.t.env.DB.prepare(
        "SELECT status,sealed,cookie_hash FROM oidc_link_actions WHERE kind='link' ORDER BY id"
      ).all()
    ).toMatchObject({
      results: [
        { status: 'cancelled', sealed: null, cookie_hash: null },
        { status: 'cancelled', sealed: null, cookie_hash: null },
      ],
    });
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM oidc_bindings'
      ).first()
    ).toEqual({ n: 0 });
  });
  it('停用后旧版部署不能复活，只有严格新版才能重新发布', async () => {
    const f = await fixture();
    await publish(f);
    await retire(f);
    expect((await post(f.t, f.cookie, admin + '/preview', {})).status).toBe(
      409
    );
    expect(
      await f.t.env.DB.prepare('SELECT version FROM oidc_providers WHERE id=?')
        .bind('company')
        .first()
    ).toEqual({ version: 1 });
    const newer = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: JSON.stringify({ ...f.description, version: 2 }),
      } as unknown as CloudflareBindings,
    };
    await publish(f, newer);
    expect(
      await (await call(newer, admin, { cookie: f.cookie })).json()
    ).toMatchObject({
      ready: true,
      active: { version: 2, generation: 3, enabled: true },
    });
    expect(
      await (await call(f.t, me, { cookie: f.cookie })).json()
    ).toMatchObject({ ready: false });
  });
  it('停用预览后配置已升级，失败CAS不能取消新动作或停用新配置', async () => {
    const f = await fixture();
    await publish(f);
    const p = await planOf(
      await post(f.t, f.cookie, admin + '/retire-preview', {})
    );
    const newer = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: JSON.stringify({ ...f.description, version: 2 }),
      } as unknown as CloudflareBindings,
    };
    await publish(f, newer);
    const newFixture = { ...f, t: newer },
      next = await pending(newFixture);
    expect((await post(newer, f.cookie, admin + '/retire', p)).status).toBe(
      409
    );
    expect(await oidc.currentConfiguration(f.t.env)).toMatchObject({
      enabled: 1,
      version: 2,
      generation: 2,
    });
    expect((await next.callback()).status).toBe(302);
    expect(
      await (
        await call(newer, me + '/actions/' + next.plan.previewId, {
          cookie: f.cookie,
        })
      ).json()
    ).toMatchObject({ status: 'candidate' });
  });
  it('管理员降权后，即使入口已放行的停用操作仍在SQL写点被拒绝', async () => {
    const f = await fixture();
    await publish(f);
    const p = await planOf(
      await post(f.t, f.cookie, admin + '/retire-preview', {})
    );
    await f.t.env.DB.prepare("UPDATE users SET role='user' WHERE id=?")
      .bind(f.owner.user.id)
      .run();
    await expect(
      oidc.retireConfiguration(
        f.t.env,
        f.owner.user.id,
        f.owner.session.id,
        p.previewId,
        p.digest
      )
    ).rejects.toMatchObject({ code: 'OIDC_ACTION_CHANGED' });
    expect(await oidc.currentConfiguration(f.t.env)).toMatchObject({
      enabled: 1,
      generation: 1,
    });
    expect(
      await f.t.env.DB.prepare(
        'SELECT status FROM oidc_link_actions WHERE id=?'
      )
        .bind(p.previewId)
        .first()
    ).toEqual({ status: 'preview' });
  });
  it('配置损坏或secret缺失仍可安全读取并撤销既有绑定、停用D1', async () => {
    const f = await fixture();
    await publish(f);
    const { binding: saved } = await binding(f);
    for (const bad of ['{broken-json', JSON.stringify(f.description)]) {
      const broken = {
        ...f.t,
        env: {
          ...f.t.env,
          OIDC_PROVIDER: bad,
          OIDC_CLIENT_SECRET: '',
        } as unknown as CloudflareBindings,
      };
      const own = await call(broken, me, { cookie: f.cookie }),
        status = await call(broken, admin, { cookie: f.cookie });
      expect(own.status).toBe(200);
      expect(await own.json()).toMatchObject({
        provider: null,
        ready: false,
        configurationError: true,
        bindings: [{ id: saved.id }],
      });
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        provider: null,
        ready: false,
        configurationError: true,
        active: { enabled: true },
      });
    }
    const broken = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: '{broken-json',
        OIDC_CLIENT_SECRET: '',
      } as unknown as CloudflareBindings,
    };
    expect(
      (
        await post(broken, f.cookie, me + '/revoke', {
          bindingId: saved.id,
          revision: saved.revision,
        })
      ).status
    ).toBe(200);
    await retire(f, broken);
    expect(await oidc.currentConfiguration(f.t.env)).toMatchObject({
      enabled: 0,
      generation: 2,
    });
  });
  it('停用存储失败回滚预览消费和动作取消，用户明确重试才能生效', async () => {
    const f = await fixture();
    await publish(f);
    const a = await pending(f);
    const p = await planOf(
      await post(f.t, f.cookie, admin + '/retire-preview', {})
    );
    await f.t.env.DB.prepare(
      "CREATE TRIGGER oidc_test_retire_failure BEFORE UPDATE OF enabled ON oidc_configuration WHEN NEW.enabled=0 BEGIN SELECT RAISE(ABORT,'test retire unavailable'); END"
    ).run();
    try {
      expect((await post(f.t, f.cookie, admin + '/retire', p)).status).toBe(
        409
      );
      expect(await oidc.currentConfiguration(f.t.env)).toMatchObject({
        enabled: 1,
        generation: 1,
      });
      expect(
        await f.t.env.DB.prepare(
          'SELECT status FROM oidc_link_actions WHERE id=?'
        )
          .bind(p.previewId)
          .first()
      ).toEqual({ status: 'preview' });
      expect(
        await f.t.env.DB.prepare(
          'SELECT status FROM oidc_link_actions WHERE id=?'
        )
          .bind(a.plan.previewId)
          .first()
      ).toEqual({ status: 'await_callback' });
    } finally {
      await f.t.env.DB.prepare('DROP TRIGGER oidc_test_retire_failure').run();
    }
    expect((await post(f.t, f.cookie, admin + '/retire', p)).status).toBe(200);
    expect(await oidc.currentConfiguration(f.t.env)).toMatchObject({
      enabled: 0,
      generation: 2,
    });
  });
  it('清空部署配置后仍能显式停用D1权威，旧Worker不能继续绑定', async () => {
    const f = await fixture();
    await publish(f);
    const a = await pending(f);
    const cleared = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: '',
        OIDC_CLIENT_SECRET: '',
      } as unknown as CloudflareBindings,
    };
    const p = await post(cleared, f.cookie, admin + '/retire-preview', {});
    if (p.status !== 200) {
      const old = await a.callback();
      const oldStatus = new URL(
        old.headers.get('location')!,
        'http://test.local'
      ).searchParams.get('oidc_status');
      expect(
        p.status,
        `No D1 retirement: old worker callback status=${old.status}, identity status=${oldStatus}`
      ).toBe(200);
    }
    const result = await post(
      cleared,
      f.cookie,
      admin + '/retire',
      await planOf(p)
    );
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toMatchObject({
      ready: false,
      active: { id: 'company', generation: 2, enabled: false },
    });
    expect((await a.callback()).status).toBe(409);
    expect(f.exchanges()).toBe(0);
    expect(
      await (await call(f.t, me, { cookie: f.cookie })).json()
    ).toMatchObject({ ready: false });
  });
  it('两位管理员并发发布只推进一次全局配置代数', async () => {
    const f = await fixture(),
      other = await addMember(f.t, f.cookie, 'second-admin'),
      otherIdentity = await identity(f.t, other);
    expect(
      (
        await call(f.t, '/api/auth/admin/set-role', {
          cookie: f.cookie,
          json: { userId: otherIdentity.user.id, role: 'admin' },
        })
      ).status
    ).toBe(200);
    const plans = await Promise.all([
      post(f.t, f.cookie, admin + '/preview', {}),
      post(f.t, other, admin + '/preview', {}),
    ]);
    expect(plans.map((p) => p.status)).toEqual([200, 200]);
    const [first, second] = await Promise.all(plans.map(planOf));
    const results = await Promise.all([
      post(f.t, f.cookie, admin + '/apply', first),
      post(f.t, other, admin + '/apply', second),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await oidc.currentConfiguration(f.t.env))?.generation).toBe(1);
    expect(
      await f.t.env.DB.prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='instance.oidc_configuration'"
      ).first()
    ).toEqual({ n: 1 });
  });
  it('入口已经通过后成员被封禁，最终确认写点仍不得绑定', async () => {
    const f = await fixture();
    await publish(f);
    const a = await candidate(f);
    await f.t.env.DB.prepare('UPDATE users SET banned=1 WHERE id=?')
      .bind(f.owner.user.id)
      .run();
    await expect(
      oidc.confirm(
        f.t.env,
        f.owner.user.id,
        f.owner.session.id,
        a.plan.previewId
      )
    ).rejects.toMatchObject({ code: 'OIDC_ACTION_CHANGED' });
    expect(
      await f.t.env.DB.prepare(
        'SELECT status,binding_revision FROM oidc_link_actions WHERE id=?'
      )
        .bind(a.plan.previewId)
        .first()
    ).toEqual({ status: 'candidate', binding_revision: null });
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM oidc_bindings'
      ).first()
    ).toEqual({ n: 0 });
  });
  it('绑定存储触发失败时原子回滚候选消费，明确重试不产生假成功收据', async () => {
    const f = await fixture();
    await publish(f);
    const a = await candidate(f);
    await f.t.env.DB.prepare(
      "CREATE TRIGGER oidc_test_binding_failure BEFORE INSERT ON oidc_bindings BEGIN SELECT RAISE(ABORT,'test binding unavailable'); END"
    ).run();
    try {
      expect(
        (
          await post(f.t, f.cookie, me + '/confirm', {
            actionId: a.plan.previewId,
          })
        ).status
      ).toBe(409);
      expect(
        await f.t.env.DB.prepare(
          'SELECT status,binding_id,binding_revision FROM oidc_link_actions WHERE id=?'
        )
          .bind(a.plan.previewId)
          .first()
      ).toEqual({
        status: 'candidate',
        binding_id: null,
        binding_revision: null,
      });
      expect(
        await f.t.env.DB.prepare(
          'SELECT count(*) AS n FROM oidc_bindings'
        ).first()
      ).toEqual({ n: 0 });
    } finally {
      await f.t.env.DB.prepare('DROP TRIGGER oidc_test_binding_failure').run();
    }
    expect(
      (
        await post(f.t, f.cookie, me + '/confirm', {
          actionId: a.plan.previewId,
        })
      ).status
    ).toBe(200);
  });
  it('旧callback迟到响应不能清除另一标签页新动作的独立cookie', async () => {
    const f = await fixture();
    await publish(f);
    const old = await pending(f),
      entered = deferred(),
      resume = deferred();
    f.hold(async () => {
      entered.resolve();
      await resume.promise;
    });
    const inFlight = old.callback();
    await entered.promise;
    const next = await pending(f, f.cookie, 'next-subject'),
      jar = cookieJar(f.cookie);
    jar.apply(next.started);
    resume.resolve();
    const oldResponse = await inFlight;
    expect(oldResponse.status).toBe(302);
    jar.apply(oldResponse);
    const result = await call(f.t, next.callbackPath, { cookie: jar.header() });
    expect(result.status, await result.clone().text()).toBe(302);
    expect(
      new URL(
        result.headers.get('location')!,
        'http://test.local'
      ).searchParams.get('oidc_status')
    ).toBe('candidate');
  });
  it('旧start迟到响应不能覆盖另一标签页新动作的独立cookie', async () => {
    const f = await fixture();
    await publish(f);
    const entered = deferred(),
      resume = deferred();
    let first = true;
    f.holdDiscovery(async () => {
      if (first) {
        first = false;
        entered.resolve();
        await resume.promise;
      }
    });
    const plan = await planOf(await post(f.t, f.cookie, me + '/preview', {}));
    const inFlight = post(f.t, f.cookie, me + '/start', plan);
    await entered.promise;
    const next = await pending(f, f.cookie, 'next-subject'),
      jar = cookieJar(f.cookie);
    jar.apply(next.started);
    resume.resolve();
    const oldResponse = await inFlight;
    expect(oldResponse.status).toBe(200);
    jar.apply(oldResponse);
    const result = await call(f.t, next.callbackPath, { cookie: jar.header() });
    expect(result.status, await result.clone().text()).toBe(302);
    expect(
      new URL(
        result.headers.get('location')!,
        'http://test.local'
      ).searchParams.get('oidc_status')
    ).toBe('candidate');
  });
  it('候选之后真实重生成恢复码，旧因子代数不能完成绑定', async () => {
    const f = await fixture();
    await publish(f);
    const begin = await call(f.t, '/api/auth/two-factor/enable', {
      cookie: f.cookie,
      json: { password: 'password123' },
    });
    expect(begin.status).toBe(200);
    const { totpURI } = (await begin.json()) as { totpURI: string };
    const otp = createOTP(
      new TextDecoder().decode(
        base32.decode(new URL(totpURI).searchParams.get('secret')!)
      )
    );
    const verified = await call(f.t, '/api/auth/two-factor/verify-totp', {
      cookie: f.cookie,
      json: { code: await otp.totp() },
    });
    expect(verified.status).toBe(200);
    f.cookie = cookies(verified);
    f.owner = await identity(f.t, f.cookie);
    const a = await candidate(f);
    const regenerate = await call(
      f.t,
      '/api/auth/two-factor/generate-backup-codes',
      { cookie: f.cookie, json: { password: 'password123' } }
    );
    expect(regenerate.status, await regenerate.clone().text()).toBe(200);
    expect(
      (
        await post(f.t, f.cookie, me + '/confirm', {
          actionId: a.plan.previewId,
        })
      ).status
    ).toBe(409);
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM oidc_bindings'
      ).first()
    ).toEqual({ n: 0 });
  });
  it('非安全关键审计失败不撤销已经原子提交的绑定和动作收据', async () => {
    const f = await fixture();
    await publish(f);
    const a = await candidate(f);
    await f.t.env.DB.prepare(
      "CREATE TRIGGER oidc_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='user.oidc_linked' BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END"
    ).run();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await post(f.t, f.cookie, me + '/confirm', {
        actionId: a.plan.previewId,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        await f.t.env.DB.prepare(
          'SELECT status,binding_revision FROM oidc_link_actions WHERE id=?'
        )
          .bind(a.plan.previewId)
          .first()
      ).toEqual({ status: 'confirmed', binding_revision: 1 });
      expect(
        await f.t.env.DB.prepare(
          'SELECT active,revision FROM oidc_bindings'
        ).first()
      ).toEqual({ active: 1, revision: 1 });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      await f.t.env.DB.prepare('DROP TRIGGER oidc_test_audit_failure').run();
    }
  });
  it('管理员预览后发布单例版本，不泄漏secret/digest，同一预览不能重放', async () => {
    const f = await fixture();
    const initial = await call(f.t, admin, { cookie: f.cookie });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      ready: false,
      configured: true,
      active: null,
    });
    const plan = await publish(f);
    const state = await call(f.t, admin, { cookie: f.cookie }),
      text = await state.text();
    expect(JSON.parse(text)).toMatchObject({
      ready: true,
      active: { id: 'company', version: 1, generation: 1 },
    });
    expect(text).not.toContain('secret');
    expect(text).not.toContain('digest');
    expect((await post(f.t, f.cookie, admin + '/apply', plan)).status).toBe(
      409
    );
    expect((await post(f.t, f.cookie, admin + '/preview', {})).status).toBe(
      409
    );
    expect(
      await f.t.env.DB.prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='instance.oidc_configuration'"
      ).first()
    ).toEqual({ n: 1 });
  });
  it('回调仅建立候选，再明确确认原子绑定并记录实际收据，不创建账户或会话', async () => {
    const f = await fixture();
    await publish(f);
    const before = await f.t.env.DB.prepare(
      'SELECT (SELECT count(*) FROM accounts) AS accounts,(SELECT count(*) FROM sessions) AS sessions'
    ).first();
    const proof = await f.t.env.DB.prepare(
      'SELECT auth_time,second_factor_time,auth_version,policy_version FROM sessions WHERE id=?'
    )
      .bind(f.owner.session.id)
      .first();
    const a = await candidate(f);
    expect(a.started.headers.getSetCookie().join('; ')).toContain('HttpOnly');
    expect(a.started.headers.getSetCookie().join('; ')).toContain(
      'SameSite=Lax'
    );
    expect(a.started.headers.getSetCookie().join('; ')).toContain(
      '/api/auth/oidc/callback/company'
    );
    expect(
      await f.t.env.DB.prepare(
        'SELECT count(*) AS n FROM oidc_bindings'
      ).first()
    ).toEqual({ n: 0 });
    const status = await call(f.t, me + '/actions/' + a.plan.previewId, {
      cookie: f.cookie,
    });
    expect(await status.json()).toMatchObject({
      status: 'candidate',
      identity: { issuer: f.issuer, subject: 'external-subject' },
    });
    const result = await post(f.t, f.cookie, me + '/confirm', {
      actionId: a.plan.previewId,
    });
    expect(result.status, await result.clone().text()).toBe(200);
    const saved = await result.json();
    expect(saved).toMatchObject({
      binding: { revision: 1, subject: 'external-subject' },
    });
    expect(
      await (
        await post(f.t, f.cookie, me + '/confirm', {
          actionId: a.plan.previewId,
        })
      ).json()
    ).toEqual(saved);
    expect(
      await f.t.env.DB.prepare(
        'SELECT (SELECT count(*) FROM accounts) AS accounts,(SELECT count(*) FROM sessions) AS sessions'
      ).first()
    ).toEqual(before);
    expect(
      await f.t.env.DB.prepare(
        'SELECT auth_time,second_factor_time,auth_version,policy_version FROM sessions WHERE id=?'
      )
        .bind(f.owner.session.id)
        .first()
    ).toEqual(proof);
    const row = await f.t.env.DB.prepare(
      'SELECT * FROM oidc_link_actions WHERE id=?'
    )
      .bind(a.plan.previewId)
      .first();
    expect(row).toMatchObject({
      status: 'confirmed',
      sealed: null,
      state_hash: null,
      cookie_hash: null,
      capability_hash: null,
      binding_revision: 1,
    });
    expect(JSON.stringify(row)).not.toContain('must-not-be-stored');
    expect(
      await f.t.env.DB.prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='user.oidc_linked'"
      ).first()
    ).toEqual({ n: 1 });
  });
  it('强制绑定原cookie/session，丢失独立cookie或换成员不能领取回调', async () => {
    const f = await fixture(),
      other = await addMember(f.t, f.cookie, 'other');
    await publish(f);
    const a = await pending(f);
    expect((await call(f.t, a.callbackPath)).status).toBe(401);
    expect((await call(f.t, a.callbackPath, { cookie: f.cookie })).status).toBe(
      400
    );
    expect(
      (
        await call(f.t, a.callbackPath, {
          cookie: [other, cookies(a.started)].join('; '),
        })
      ).status
    ).toBe(400);
    expect(f.exchanges()).toBe(0);
    expect((await a.callback()).status).toBe(302);
    expect(f.exchanges()).toBe(1);
    expect((await a.callback()).status).toBe(400);
    expect(f.exchanges()).toBe(1);
  });
  it('并发重复回调只领取一次，失败的重复请求不破坏已领取的交换', async () => {
    const f = await fixture();
    await publish(f);
    const a = await pending(f),
      entered = deferred(),
      resume = deferred();
    f.hold(async () => {
      entered.resolve();
      await resume.promise;
    });
    const first = a.callback();
    await entered.promise;
    const duplicate = await a.callback();
    expect(duplicate.status).toBe(302);
    expect(f.exchanges()).toBe(1);
    resume.resolve();
    expect((await first).status).toBe(302);
    expect(
      await (
        await call(f.t, me + '/actions/' + a.plan.previewId, {
          cookie: f.cookie,
        })
      ).json()
    ).toMatchObject({ status: 'candidate' });
  });
  it('在外部交换期间取消动作，迟到的有效签名身份不能保存候选', async () => {
    const f = await fixture();
    await publish(f);
    const a = await pending(f),
      entered = deferred(),
      resume = deferred();
    f.hold(async () => {
      entered.resolve();
      await resume.promise;
    });
    const callback = a.callback();
    await entered.promise;
    expect(
      (
        await post(f.t, f.cookie, me + '/cancel', {
          actionId: a.plan.previewId,
        })
      ).status
    ).toBe(200);
    resume.resolve();
    expect((await callback).status).toBe(302);
    expect(
      await (
        await call(f.t, me + '/actions/' + a.plan.previewId, {
          cookie: f.cookie,
        })
      ).json()
    ).toMatchObject({ status: 'cancelled', identity: null });
    expect(
      (
        await post(f.t, f.cookie, me + '/confirm', {
          actionId: a.plan.previewId,
        })
      ).status
    ).toBe(409);
  });
  for (const changed of ['proof', 'policy', 'credential'] as const)
    it(`外部交换期间${changed}变化，最终候选写点拒绝旧动作`, async () => {
      const f = await fixture();
      await publish(f);
      const a = await pending(f),
        entered = deferred(),
        resume = deferred();
      f.hold(async () => {
        entered.resolve();
        await resume.promise;
      });
      const callback = a.callback();
      await entered.promise;
      if (changed === 'proof')
        await f.t.env.DB.prepare(
          'UPDATE sessions SET auth_time=auth_time-1 WHERE id=?'
        )
          .bind(f.owner.session.id)
          .run();
      if (changed === 'credential')
        await f.t.env.DB.prepare(
          'UPDATE users SET auth_version=auth_version+1 WHERE id=?'
        )
          .bind(f.owner.user.id)
          .run();
      if (changed === 'policy')
        await f.t.env.DB.prepare(
          'INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,0)'
        ).run();
      resume.resolve();
      expect((await callback).status).toBe(302);
      expect(
        await f.t.env.DB.prepare(
          'SELECT status,sealed,subject FROM oidc_link_actions WHERE id=?'
        )
          .bind(a.plan.previewId)
          .first()
      ).toEqual({ status: 'failed', sealed: null, subject: null });
      expect(
        await f.t.env.DB.prepare(
          'SELECT count(*) AS n FROM oidc_bindings'
        ).first()
      ).toEqual({ n: 0 });
    });
  it('预览过期或重新验证后不能用新proof挽救旧预览', async () => {
    const f = await fixture();
    await publish(f);
    const p = await planOf(await post(f.t, f.cookie, me + '/preview', {}));
    vi.setSystemTime(Date.now() + 1000);
    expect(
      (
        await call(f.t, '/api/auth/reauthenticate', {
          cookie: f.cookie,
          json: { sessionId: f.owner.session.id, password: 'password123' },
        })
      ).status
    ).toBe(200);
    expect((await post(f.t, f.cookie, me + '/start', p)).status).toBe(409);
    const current = await planOf(
      await post(f.t, f.cookie, me + '/preview', {})
    );
    vi.setSystemTime(Date.now() + 120001);
    expect((await post(f.t, f.cookie, me + '/start', current)).status).toBe(
      409
    );
  });
  it('部署配置发布推进全局代数，旧部署和旧动作都不能继续使用', async () => {
    const f = await fixture();
    await publish(f);
    const a = await pending(f);
    const replacement = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: JSON.stringify({ ...f.description, version: 2 }),
      } as unknown as CloudflareBindings,
    };
    await publish(f, replacement);
    expect(
      await (await call(f.t, me, { cookie: f.cookie })).json()
    ).toMatchObject({ ready: false });
    expect((await a.callback()).status).toBe(409);
    expect(f.exchanges()).toBe(0);
    expect(
      (
        await post(f.t, f.cookie, me + '/confirm', {
          actionId: a.plan.previewId,
        })
      ).status
    ).toBe(409);
  });
  it('不可变issuer、历史版本及全局发布CAS都在数据库围栏内', async () => {
    const f = await fixture();
    await publish(f);
    const changed = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: JSON.stringify({
          ...f.description,
          issuer: 'https://different.example',
          version: 2,
        }),
      } as unknown as CloudflareBindings,
    };
    expect((await post(changed, f.cookie, admin + '/preview', {})).status).toBe(
      409
    );
    const second = {
      ...f.t,
      env: {
        ...f.t.env,
        OIDC_PROVIDER: JSON.stringify({
          ...f.description,
          id: 'another',
          version: 1,
        }),
      } as unknown as CloudflareBindings,
    };
    await publish(f, second);
    expect((await post(f.t, f.cookie, admin + '/preview', {})).status).toBe(
      409
    );
    expect((await oidc.currentConfiguration(f.t.env))?.generation).toBe(2);
    await expect(
      f.t.env.DB.prepare('UPDATE oidc_providers SET issuer=? WHERE id=?')
        .bind('https://different.example', 'company')
        .run()
    ).rejects.toThrow('OIDC provider identity');
  });
  it('撤销保留身份墓碑，取消旧候选；其他成员不能接管，原owner新动作才可重绑', async () => {
    const f = await fixture(),
      other = await addMember(f.t, f.cookie, 'other');
    await publish(f);
    const { binding: saved } = await binding(f),
      old = await candidate(f);
    expect(
      (
        await post(f.t, f.cookie, me + '/revoke', {
          bindingId: saved.id,
          revision: saved.revision,
        })
      ).status
    ).toBe(200);
    expect(
      (
        await post(f.t, f.cookie, me + '/confirm', {
          actionId: old.plan.previewId,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await post(f.t, f.cookie, me + '/revoke', {
          bindingId: saved.id,
          revision: saved.revision,
        })
      ).status
    ).toBe(409);
    const attempted = await candidate(f, other);
    expect(
      (
        await post(f.t, other, me + '/confirm', {
          actionId: attempted.plan.previewId,
        })
      ).status
    ).toBe(409);
    const restored = await binding(f);
    expect(restored.binding).toMatchObject({ id: saved.id, revision: 3 });
    expect(
      await f.t.env.DB.prepare(
        'SELECT user_id,revision FROM oidc_bindings WHERE id=?'
      )
        .bind(saved.id)
        .first()
    ).toEqual({ user_id: f.owner.user.id, revision: 3 });
  });
  it('删除身份owner后仍保留不可转移墓碑', async () => {
    const f = await fixture(),
      other = await addMember(f.t, f.cookie, 'other');
    await publish(f);
    const owned = await binding(f, other),
      owner = await identity(f.t, other);
    await f.t.env.DB.prepare('DELETE FROM users WHERE id=?')
      .bind(owner.user.id)
      .run();
    expect(
      await f.t.env.DB.prepare('SELECT user_id FROM oidc_bindings WHERE id=?')
        .bind(owned.binding.id)
        .first()
    ).toEqual({ user_id: null });
    const next = await candidate(f);
    expect(
      (
        await post(f.t, f.cookie, me + '/confirm', {
          actionId: next.plan.previewId,
        })
      ).status
    ).toBe(409);
    await expect(
      f.t.env.DB.prepare('UPDATE oidc_bindings SET user_id=? WHERE id=?')
        .bind(f.owner.user.id, owned.binding.id)
        .run()
    ).rejects.toThrow('ownership is permanent');
  });
  it('入口拒绝无session header、未知字段、跨会话读动作及秘密响应缓存', async () => {
    const f = await fixture();
    await publish(f);
    expect(
      (await call(f.t, me + '/preview', { cookie: f.cookie, json: {} })).status
    ).toBe(401);
    expect(
      (await post(f.t, f.cookie, me + '/preview', { userId: f.owner.user.id }))
        .status
    ).toBe(400);
    const a = await pending(f),
      other = await addMember(f.t, f.cookie, 'other');
    expect(
      (await call(f.t, me + '/actions/' + a.plan.previewId, { cookie: other }))
        .status
    ).toBe(404);
    for (const r of [await call(f.t, me), await call(f.t, admin)])
      expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await providerFrom(f.t.env))?.secret).toBe(
      'local-client-secret-not-returned'
    );
  });
});
