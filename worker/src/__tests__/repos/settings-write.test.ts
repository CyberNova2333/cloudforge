// CloudForge fork addition (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { needsRecentRestAuthentication } from '../../auth/recent';
import { GitService } from '../../git/service';
import {
  addMember,
  bootstrapAdmin,
  call,
  makeEnv,
  type TestEnv,
} from '../helpers/app';

afterEach(() => vi.restoreAllMocks());
const clock = "CAST(unixepoch('subsecond') * 1000 AS INTEGER)";
type Body = Record<string, unknown>;
async function fixture(
  options: { admin?: boolean; team?: boolean; empty?: boolean } = {}
) {
  const t = makeEnv();
  const admin = await bootstrapAdmin(t);
  const member = await addMember(t, admin, 'member');
  if (options.team) {
    const team = await call(t, '/api/team', {
      cookie: admin,
      method: 'PUT',
      json: { name: 'Team', slug: 'team' },
    });
    expect(team.status).toBe(200);
  }
  const created = await call(t, '/api/repos', {
    cookie: member,
    json: {
      name: 'app',
      owner: options.team ? 'team' : 'user',
      description: 'Before',
      addReadme: !options.empty,
    },
  });
  expect(created.status).toBe(201);
  const repo = (await created.json()) as {
    id: string;
    owner: { username: string };
  };
  const cookie = options.admin ? admin : member;
  const identity = (await (
    await call(t, '/api/auth/get-session', { cookie })
  ).json()) as { user: { id: string }; session: { id: string } };
  const adminId = (await t.env.DB.prepare(
    "SELECT id FROM users WHERE username='octocat'"
  ).first<string>('id'))!;
  const ownerId = (await t.env.DB.prepare(
    "SELECT id FROM users WHERE username='member'"
  ).first<string>('id'))!;
  await t.env.DB.prepare(
    `UPDATE sessions SET auth_time=${clock}-1000 WHERE id=?`
  )
    .bind(identity.session.id)
    .run();
  return {
    t,
    cookie,
    admin,
    member,
    adminId,
    ownerId,
    userId: identity.user.id,
    sessionId: identity.session.id,
    repoId: repo.id,
    path: `/api/repos/${repo.owner.username}/app`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const request = (f: Fixture, body: Body = { description: 'After' }) =>
  call(f.t, f.path, { cookie: f.cookie, method: 'PATCH', json: body });
const run = async (
  f: Fixture,
  query: string,
  ...params: (string | number | null)[]
) => {
  await f.t.env.DB.prepare(query)
    .bind(...params)
    .run();
};
async function snapshot(t: TestEnv) {
  return {
    repositories: (
      await t.env.DB.prepare('SELECT * FROM repositories ORDER BY id').all()
    ).results,
    audits: (
      await t.env.DB.prepare(
        "SELECT * FROM audit_events WHERE action IN ('settings.changed','visibility.changed') ORDER BY id"
      ).all()
    ).results,
  };
}

/** Schedule a real D1 change immediately before the real bound repository UPDATE executes. */
function writeBoundary(
  t: TestEnv,
  before: () => Promise<void> = async () => {}
) {
  const prepare = t.env.DB.prepare.bind(t.env.DB);
  const batch = t.env.DB.batch.bind(t.env.DB);
  const entries = new WeakMap<
    D1PreparedStatement,
    { original: D1PreparedStatement; query: string }
  >();
  let calls = 0;
  let inside = false;
  const enter = async (queries: string[]) => {
    if (
      inside ||
      !queries.some((q) => /^\s*update\s+["`]?repositories["`]?\s/i.test(q))
    )
      return;
    calls++;
    if (calls === 1) {
      inside = true;
      try {
        await before();
      } finally {
        inside = false;
      }
    }
  };
  const wrap = (
    original: D1PreparedStatement,
    query: string
  ): D1PreparedStatement => {
    const statement = new Proxy(original, {
      get(target, property) {
        if (property === 'bind')
          return (...args: unknown[]) => wrap(target.bind(...args), query);
        if (['all', 'run', 'raw', 'first'].includes(String(property)))
          return async (...args: unknown[]) => {
            await enter([query]);
            return Reflect.apply(Reflect.get(target, property), target, args);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    entries.set(statement, { original, query });
    return statement;
  };
  const prepared = vi
    .spyOn(t.env.DB, 'prepare')
    .mockImplementation((q) => wrap(prepare(q), q));
  const batched = vi
    .spyOn(t.env.DB, 'batch')
    .mockImplementation(async (statements) => {
      await enter(statements.map((s) => entries.get(s)?.query ?? ''));
      return batch(statements.map((s) => entries.get(s)?.original ?? s));
    });
  return {
    calls: () => calls,
    restore: () => {
      prepared.mockRestore();
      batched.mockRestore();
    },
  };
}
async function denied(
  f: Fixture,
  invalidate: () => Promise<void>,
  body?: Body
) {
  let expected = await snapshot(f.t);
  const boundary = writeBoundary(f.t, async () => {
    await invalidate();
    expected = await snapshot(f.t);
  });
  let response: Response;
  try {
    response = await request(f, body);
  } finally {
    boundary.restore();
  }
  expect(boundary.calls()).toBe(1);
  expect(response!.status).toBe(409);
  expect(response!.headers.get('Cache-Control')).toBe('no-store');
  expect(await response!.text()).not.toMatch(
    /RECENT_AUTHENTICATION_REQUIRED|SQLITE|UPDATE repositories|auth_version|password123|fixture-secret/
  );
  expect(await snapshot(f.t)).toEqual(expected);
}

describe('仓库设置在真实 D1 写点保留原授权', () => {
  it('仅精确仓库根PATCH增加近期认证；读、创建、删除和子资源不扩大范围', () => {
    for (const path of ['/api/repos/member/app', '/api/repos/member/app/'])
      expect(needsRecentRestAuthentication('PATCH', path)).toBe(true);
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE'])
      expect(
        needsRecentRestAuthentication(method, '/api/repos/member/app')
      ).toBe(false);
    for (const path of [
      '/api/repos',
      '/api/repos/member/app/branches',
      '/api/repos/member/app/collaborators/member',
    ])
      expect(needsRecentRestAuthentication('PATCH', path)).toBe(false);
  });
  for (const body of [{ description: 'After' }, {}]) {
    const label = Object.keys(body).length ? '修改' : '空PATCH';
    it.each(['lost', 'aba'] as const)(
      `${label} 在所有权 %s 后拒绝`,
      async (change) => {
        const f = await fixture();
        await denied(
          f,
          async () => {
            await run(
              f,
              'UPDATE repositories SET owner_id=? WHERE id=?',
              f.adminId,
              f.repoId
            );
            if (change === 'aba')
              await run(
                f,
                'UPDATE repositories SET owner_id=? WHERE id=?',
                f.ownerId,
                f.repoId
              );
          },
          body
        );
      }
    );
    it.each(['lost', 'aba'] as const)(
      `${label} 在非owner管理员身份 %s 后拒绝`,
      async (change) => {
        const f = await fixture({ admin: true });
        await denied(
          f,
          async () => {
            await run(f, "UPDATE users SET role='user' WHERE id=?", f.adminId);
            if (change === 'aba')
              await run(
                f,
                "UPDATE users SET role='admin' WHERE id=?",
                f.adminId
              );
          },
          body
        );
      }
    );
    const changes = [
      ['session-removed', 'DELETE FROM sessions WHERE id=?', 'session'],
      [
        'session-expired',
        'UPDATE sessions SET expires_at=0 WHERE id=?',
        'session',
      ],
      ['banned', 'UPDATE users SET banned=1 WHERE id=?', 'user'],
      [
        'proof-expired',
        `UPDATE sessions SET auth_time=${clock}-360000 WHERE id=?`,
        'session',
      ],
      [
        'proof-replaced',
        'UPDATE sessions SET auth_time=auth_time-1 WHERE id=?',
        'session',
      ],
      [
        'credential-removed',
        "DELETE FROM accounts WHERE provider_id='credential' AND user_id=?",
        'user',
      ],
      [
        'credential-rotated',
        "UPDATE accounts SET password=password||'-changed' WHERE provider_id='credential' AND user_id=?",
        'user',
      ],
      [
        'policy-generation',
        'INSERT INTO authentication_policy(id,version,require_mfa) VALUES(1,1,0) ON CONFLICT(id) DO UPDATE SET version=version+1',
        'none',
      ],
    ] as const;
    it.each(changes)(
      `${label} 在 %s 后拒绝且不审计成功`,
      async (_, query, target) => {
        const f = await fixture();
        await denied(
          f,
          () =>
            run(
              f,
              query,
              ...(target === 'none'
                ? []
                : [target === 'session' ? f.sessionId : f.userId])
            ),
          body
        );
      }
    );
    it(`${label} 不用并发成功重验替换原证明`, async () => {
      const f = await fixture();
      await denied(
        f,
        async () => {
          const r = await call(f.t, '/api/auth/reauthenticate', {
            cookie: f.cookie,
            json: { sessionId: f.sessionId, password: 'password123' },
          });
          expect(r.status).toBe(200);
        },
        body
      );
    });
  }
});

// Authority fixtures only; the dedicated factor/OIDC suites verify enrollment and protocol issuance.
async function withFactor(f: Fixture) {
  await f.t.env.DB.batch([
    f.t.env.DB.prepare(
      'INSERT INTO two_factors(id,user_id,secret,backup_codes,verified) VALUES(?,?,?,?,1)'
    ).bind('repo-factor', f.userId, 'fixture-secret', '[]'),
    f.t.env.DB.prepare('UPDATE users SET two_factor_enabled=1 WHERE id=?').bind(
      f.userId
    ),
    f.t.env.DB.prepare(
      `UPDATE sessions SET auth_version=(SELECT auth_version FROM users WHERE id=?),auth_time=${clock}-1000,second_factor_method='totp',second_factor_time=${clock}-1000 WHERE id=?`
    ).bind(f.userId, f.sessionId),
  ]);
}
async function withSource(f: Fixture) {
  const now = Date.now();
  await f.t.env.DB.batch([
    f.t.env.DB.prepare(
      'INSERT INTO oidc_providers(id,issuer,version,digest,created_at) VALUES(?,?,1,?,?)'
    ).bind(
      'repo-provider',
      'https://identity.example/repository',
      'repo-digest',
      now
    ),
    f.t.env.DB.prepare(
      'INSERT INTO oidc_configuration(id,enabled,login_enabled,provider_id,version,digest,generation,action_id,updated_at) VALUES(1,1,1,?,1,?,1,?,?)'
    ).bind('repo-provider', 'repo-digest', crypto.randomUUID(), now),
    f.t.env.DB.prepare(
      'INSERT INTO oidc_bindings(id,provider_id,issuer,subject,user_id,active,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)'
    ).bind(
      'repo-binding',
      'repo-provider',
      'https://identity.example/repository',
      'repo-subject',
      f.userId,
      now,
      now
    ),
    f.t.env.DB.prepare(
      'UPDATE sessions SET oidc_binding_id=?,oidc_binding_revision=1,oidc_configuration_generation=1 WHERE id=?'
    ).bind('repo-binding', f.sessionId),
  ]);
}
describe('仓库设置的因素和SSO来源证明', () => {
  it.each([
    ['removed', 'DELETE FROM two_factors'],
    [
      'recovery-version',
      'UPDATE two_factors SET recovery_version=recovery_version+1',
    ],
    ['unverified', 'UPDATE two_factors SET verified=0'],
    [
      'proof-replaced',
      'UPDATE sessions SET second_factor_time=second_factor_time-1',
    ],
  ])('因子 %s 后不写入', async (_, query) => {
    const f = await fixture();
    await withFactor(f);
    await denied(f, () => run(f, query));
  });
  it.each([
    ['binding-revision', 'UPDATE oidc_bindings SET revision=revision+1'],
    [
      'configuration-generation',
      'UPDATE oidc_configuration SET generation=generation+1',
    ],
    ['configuration-disabled', 'UPDATE oidc_configuration SET enabled=0'],
  ])('来源 %s 后不写入', async (_, query) => {
    const f = await fixture();
    await withSource(f);
    await denied(f, () => run(f, query));
  });
  it.each(['factor', 'source'] as const)(
    '当前 %s 证明保留成功路径',
    async (kind) => {
      const f = await fixture();
      await (kind === 'factor' ? withFactor(f) : withSource(f));
      expect((await request(f)).status).toBe(200);
    }
  );
});

describe('仓库设置目标快照与异步交接', () => {
  it.each([
    ['name', "name='renamed'"],
    ['description', "description='Concurrent'"],
    ['default-branch', "default_branch='other'"],
    ['visibility', "visibility='public'"],
    ['protection', `protected_branches='["release/*"]'`],
    ['delete-merged', 'delete_merged_branches=0'],
    ['issues', 'has_issues=0'],
    ['storage', "artifacts_name='changed-storage'"],
  ])('已读取的 %s 在实际写入前变化时不覆盖或伪造审计', async (_, set) => {
    const f = await fixture();
    await denied(f, () =>
      run(f, `UPDATE repositories SET ${set} WHERE id=?`, f.repoId)
    );
  });
  it('用户命名空间改名后旧URL不写入', async () => {
    const f = await fixture();
    await denied(f, () =>
      run(f, "UPDATE users SET username='renamed-member' WHERE id=?", f.ownerId)
    );
  });
  it('团队命名空间改名后旧URL不写入', async () => {
    const f = await fixture({ team: true });
    await denied(f, () => run(f, "UPDATE teams SET slug='renamed-team'"));
  });
  it('切换到团队命名空间后旧个人URL不写入', async () => {
    const f = await fixture();
    expect(
      (
        await call(f.t, '/api/team', {
          cookie: f.admin,
          method: 'PUT',
          json: { name: 'Team', slug: 'team' },
        })
      ).status
    ).toBe(200);
    await denied(f, () =>
      run(
        f,
        "UPDATE repositories SET team_id=(SELECT id FROM teams),visibility='internal' WHERE id=?",
        f.repoId
      )
    );
  });
  it('目标删除后不返回伪造的成功DTO', async () => {
    const f = await fixture();
    await denied(f, () =>
      run(f, 'DELETE FROM repositories WHERE id=?', f.repoId)
    );
  });
  it('旧ID删除后同URL的新仓库不接收迟到写入', async () => {
    const f = await fixture();
    await denied(f, async () => {
      await run(f, 'DELETE FROM repositories WHERE id=?', f.repoId);
      const r = await call(f.t, '/api/repos', {
        cookie: f.member,
        json: { name: 'app' },
      });
      expect(r.status).toBe(201);
      expect(((await r.json()) as { id: string }).id).not.toBe(f.repoId);
    });
  });
  it('新名称被另一个并发请求占用时返回409而非数据库错误', async () => {
    const f = await fixture();
    await denied(
      f,
      async () => {
        expect(
          (
            await call(f.t, '/api/repos', {
              cookie: f.member,
              json: { name: 'next' },
            })
          ).status
        ).toBe(201);
      },
      { name: 'next' }
    );
  });
  it('默认分支远端读取期间撤销会话，恢复后不写入', async () => {
    const f = await fixture();
    const stored = [...f.t.fake.repos.values()][0];
    stored.refs.set('refs/heads/next', stored.refs.get('refs/heads/main')!);
    const before = await snapshot(f.t);
    const original = GitService.prototype.refs;
    let calls = 0;
    vi.spyOn(GitService.prototype, 'refs').mockImplementation(async function (
      this: GitService
    ) {
      const refs = await original.call(this);
      calls++;
      if (calls === 1)
        await run(f, 'DELETE FROM sessions WHERE id=?', f.sessionId);
      return refs;
    });
    const r = await request(f, { defaultBranch: 'next' });
    expect(calls).toBe(1);
    expect(r.status).toBe(409);
    expect(await snapshot(f.t)).toEqual(before);
  });
  it('不把非设置的合法计数器更新当成冲突，返回数据库实际DTO', async () => {
    const f = await fixture();
    const b = writeBoundary(f.t, () =>
      run(
        f,
        'UPDATE repositories SET next_pr_number=next_pr_number+1 WHERE id=?',
        f.repoId
      )
    );
    let r: Response;
    try {
      r = await request(f);
    } finally {
      b.restore();
    }
    expect(r!.status).toBe(200);
    expect(await r!.json()).toMatchObject({
      id: f.repoId,
      description: 'After',
    });
    expect(
      await f.t.env.DB.prepare(
        'SELECT next_pr_number FROM repositories WHERE id=?'
      )
        .bind(f.repoId)
        .first<number>('next_pr_number')
    ).toBe(2);
  });
});

describe('仓库设置的输入、近期认证和成功语义', () => {
  it('空仓库的完整设置表单保留默认分支即可保存，实际换到不存在分支仍拒绝', async () => {
    const f = await fixture({ empty: true });
    const r = await request(f, {
      name: 'app',
      description: 'After',
      defaultBranch: 'main',
      protectedBranches: [],
      visibility: 'private',
      deleteMergedBranches: true,
      hasIssues: true,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      id: f.repoId,
      description: 'After',
      defaultBranch: 'main',
    });
    const before = await snapshot(f.t);
    expect((await request(f, { defaultBranch: 'missing' })).status).toBe(400);
    expect(await snapshot(f.t)).toEqual(before);
  });
  it('过期证明先challenge；本地重验后一次明确重试成功，错会话被拒绝', async () => {
    const f = await fixture();
    const before = await snapshot(f.t);
    await run(
      f,
      `UPDATE sessions SET auth_time=${clock}-360000 WHERE id=?`,
      f.sessionId
    );
    const r = await request(f);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({
      code: 'RECENT_AUTHENTICATION_REQUIRED',
      sessionId: f.sessionId,
    });
    expect(await snapshot(f.t)).toEqual(before);
    expect(
      (
        await call(f.t, '/api/auth/reauthenticate', {
          cookie: f.cookie,
          json: { sessionId: f.sessionId, password: 'password123' },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(f.t, f.path, {
          cookie: f.cookie,
          method: 'PATCH',
          json: { description: 'After' },
          headers: { 'X-CloudForge-Session': f.sessionId },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call(f.t, f.path, {
          cookie: f.cookie,
          method: 'PATCH',
          json: { description: 'Wrong' },
          headers: { 'X-CloudForge-Session': 'other-session' },
        })
      ).status
    ).toBe(401);
  });
  it('个人owner、非owner站点管理员可修改；普通协作者不能修改', async () => {
    const f = await fixture();
    expect((await request(f)).status).toBe(200);
    expect(
      (await request({ ...f, cookie: f.admin }, { description: 'Admin' }))
        .status
    ).toBe(200);
    const other = await addMember(f.t, f.admin, 'other');
    expect(
      (
        await call(f.t, `${f.path}/collaborators/other`, {
          cookie: f.member,
          method: 'PUT',
        })
      ).status
    ).toBe(200);
    expect((await request({ ...f, cookie: other })).status).toBe(403);
  });
  it('规范化到自身的名称、空PATCH和同值PATCH成功但不新增变更审计', async () => {
    const f = await fixture();
    for (const body of [
      {},
      { name: ' app ' },
      {
        name: 'app',
        description: 'Before',
        defaultBranch: 'main',
        protectedBranches: null,
        deleteMergedBranches: true,
        hasIssues: true,
        visibility: 'private',
      },
    ]) {
      const r = await request(f, body);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({
        id: f.repoId,
        name: 'app',
        description: 'Before',
        defaultBranch: 'main',
        protectedBranches: [],
        deleteMergedBranches: true,
        hasIssues: true,
        visibility: 'private',
      });
    }
    expect((await snapshot(f.t)).audits).toEqual([]);
  });
  it('七个设置共同保存并保留规范化、返回字段与两类审计', async () => {
    const f = await fixture();
    const r = await request(f, {
      name: ' new name ',
      description: '  New description  ',
      defaultBranch: 'main',
      protectedBranches: ['release/*', 'release/*'],
      visibility: 'public',
      deleteMergedBranches: false,
      hasIssues: false,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      id: f.repoId,
      name: 'new-name',
      fullName: 'member/new-name',
      ownerType: 'user',
      description: 'New description',
      defaultBranch: 'main',
      protectedBranches: ['release/*'],
      visibility: 'public',
      deleteMergedBranches: false,
      hasIssues: false,
    });
    const audits = (await snapshot(f.t)).audits;
    expect(audits).toHaveLength(2);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'settings.changed',
          actor_id: f.userId,
          target: 'member/new-name',
        }),
        expect.objectContaining({
          action: 'visibility.changed',
          actor_id: f.userId,
          target: 'member/new-name',
        }),
      ])
    );
  });
  it('团队默认internal，创建者和站点管理员仍可显式公开但不能私有', async () => {
    const f = await fixture({ team: true });
    expect((await request(f, { visibility: 'public' })).status).toBe(200);
    expect(
      (await request({ ...f, cookie: f.admin }, { visibility: 'internal' }))
        .status
    ).toBe(200);
    const before = await snapshot(f.t);
    expect((await request(f, { visibility: 'private' })).status).toBe(400);
    expect(await snapshot(f.t)).toEqual(before);
  });
  it('非法设置和不存在分支不写入，普通同名冲突返回409', async () => {
    const f = await fixture();
    expect(
      (
        await call(f.t, '/api/repos', {
          cookie: f.member,
          json: { name: 'taken' },
        })
      ).status
    ).toBe(201);
    const before = await snapshot(f.t);
    for (const body of [
      { name: '..' },
      { protectedBranches: ['bad pattern'] },
      { defaultBranch: 'missing' },
      { description: 'x'.repeat(351) },
    ])
      expect((await request(f, body)).status).toBe(400);
    expect((await request(f, { name: 'taken' })).status).toBe(409);
    expect(await snapshot(f.t)).toEqual(before);
  });
  it('审计存储失败保留一次成功写入，且不产生重复请求', async () => {
    const f = await fixture();
    await f.t.env.DB.exec(
      "CREATE TRIGGER repo_settings_test_audit_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'test audit unavailable'); END;"
    );
    const b = writeBoundary(f.t);
    let r: Response;
    try {
      r = await request(f, { description: 'After', visibility: 'public' });
    } finally {
      b.restore();
      await f.t.env.DB.exec('DROP TRIGGER repo_settings_test_audit_failure;');
    }
    expect(b.calls()).toBe(1);
    expect(r!.status).toBe(200);
    expect(await r!.json()).toMatchObject({
      description: 'After',
      visibility: 'public',
    });
    expect((await snapshot(f.t)).audits).toEqual([]);
  });
});
