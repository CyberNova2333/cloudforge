// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { applyD1Migrations, env } from 'cloudflare:test';
import { ACCESS_RUNTIME_TRIGGERS } from '../db/access-runtime-triggers';
import { ACCESS_TRIGGERS } from '../db/access-triggers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCESS_PREFLIGHT_LIMIT,
  ACCESS_PREFLIGHT_MAX_BYTES,
  accessPreflightQuery,
  accessPreflightDiscoveryQuery,
  classifyAccessSchema,
  analyzeAccessSnapshot,
} from '../../../scripts/cloudforge/access-preflight-data';

// The command intentionally inspects pre-migration data, including anomalies that
// current production constraints must reject. Keep it in a separate real D1 binding.
const db = env.ACCESS_LEGACY_DB;
await applyD1Migrations(db, env.TEST_LEGACY_D1_MIGRATIONS);
const legacyTables = (
  await db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'"
    )
    .all<{ name: string }>()
).results.map((row) => row.name);
beforeEach(async () => {
  const ordered = [
    ...legacyTables.filter((name) => name === 'repositories'),
    ...legacyTables.filter((name) => name !== 'repositories'),
  ];
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys=on'),
    ...ordered.map((name) => db.prepare(`DELETE FROM "${name}"`)),
  ]);
});
const member = (id: string, extras: Record<string, unknown> = {}) => ({
  id,
  username: id,
  role: 'user',
  banned: 0,
  ...extras,
});
const repo = (id: string, extras: Record<string, unknown> = {}) => ({
  id,
  ownerId: 'alice',
  teamId: null,
  visibility: 'private',
  name: id,
  artifactsName: `r_${id}`,
  ...extras,
});
async function seed(input: {
  users?: ReturnType<typeof member>[];
  teams?: { id: string; slug: string }[];
  repositories?: ReturnType<typeof repo>[];
  collaborators?: { repositoryId: string; userId: string }[];
  agents?: { userId: string; repositoryId: string | null }[];
}) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO users(id,name,email,email_verified,created_at,updated_at,username,role,banned)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.id'),json_extract(value,'$.id')||'@test.invalid',1,0,0,
      json_extract(value,'$.username'),json_extract(value,'$.role'),json_extract(value,'$.banned') FROM json_each(?)`
      )
      .bind(JSON.stringify(input.users ?? [])),
    db
      .prepare(
        `INSERT INTO teams(id,slug,name,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.slug'),'Shared',0 FROM json_each(?)`
      )
      .bind(JSON.stringify(input.teams ?? [])),
    db
      .prepare(
        `INSERT INTO repositories(id,owner_id,team_id,visibility,name,artifacts_name,created_at,updated_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.ownerId'),json_extract(value,'$.teamId'),json_extract(value,'$.visibility'),
      json_extract(value,'$.name'),json_extract(value,'$.artifactsName'),0,0 FROM json_each(?)`
      )
      .bind(JSON.stringify(input.repositories ?? [])),
    db
      .prepare(
        `INSERT INTO repository_collaborators(repository_id,user_id,created_at)
      SELECT json_extract(value,'$.repositoryId'),json_extract(value,'$.userId'),0 FROM json_each(?)`
      )
      .bind(JSON.stringify(input.collaborators ?? [])),
    db
      .prepare(
        `INSERT INTO agents(user_id,repository_id,name,trigger_ask,trigger_above,created_at)
      SELECT json_extract(value,'$.userId'),json_extract(value,'$.repositoryId'),'Reviewer','Review?',0.5,0 FROM json_each(?)`
      )
      .bind(JSON.stringify(input.agents ?? [])),
  ]);
}
async function raw(installation?: { id: string; ownershipNonce: string }) {
  const query = accessPreflightQuery(installation);
  const result = await db
    .prepare(query.sql)
    .bind(...query.params)
    .first<{ snapshot: string }>();
  expect(result).not.toBeNull();
  return result!.snapshot;
}
const analyze = async (installation?: { id: string; ownershipNonce: string }) =>
  analyzeAccessSnapshot(await raw(installation));
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('旧权限兼容迁移只读预检（真实D1）', () => {
  it('空库和无共享团队不选未来第一个团队，且不授权迁移、发布或回滚', async () => {
    const found = await analyze();
    expect(found.blocked).toBe(false);
    expect(found.report.legacySharedTeamId).toBeNull();
    expect(found.report.counts.users).toBe(0);
    expect(codes(found.report.warnings)).toContain(
      'no_active_human_site_admin'
    );
    expect(found.rolePublishingAllowed).toBe(false);
    expect(found.migrationApplied).toBe(false);
    expect(found.report.compatibility.rollbackSafe).toBe(false);
  });

  it('保留唯一共享团队、创建者引用、旧write协作者及全部个人/团队public集合，不产生写入', async () => {
    await seed({
      users: [member('alice', { role: 'admin' }), member('bob')],
      teams: [{ id: 'shared', slug: 'platform' }],
      repositories: [
        repo('private'),
        repo('personal-public', { visibility: 'public' }),
        repo('team-public', { teamId: 'shared', visibility: 'public' }),
        repo('team-internal', { teamId: 'shared', visibility: 'internal' }),
      ],
      collaborators: [{ repositoryId: 'private', userId: 'bob' }],
    });
    const before = await db
      .prepare('SELECT * FROM repository_collaborators')
      .all();
    const found = await analyze();
    expect(found.blocked).toBe(false);
    expect(found.report.legacySharedTeamId).toBe('shared');
    expect(found.report.publicRepositoryIds).toEqual([
      'personal-public',
      'team-public',
    ]);
    expect(found.report.compatibility).toMatchObject({
      legacyCollaboratorCount: 1,
      legacyCollaboratorsBackfillRole: 'write',
      preserveOwnerCreatorAdmin: true,
      newRolesEnabled: false,
    });
    expect(found.report.counts).toMatchObject({
      teamRepositories: 2,
      publicTeamRepositories: 1,
      activeHumanSiteAdmins: 1,
    });
    expect(
      (await db.prepare('SELECT * FROM repository_collaborators').all()).results
    ).toEqual(before.results);
    expect(
      found.snapshot.repositories.find((row) => row.id === 'team-public')
        ?.ownerId
    ).toBe('alice');
  });

  it('多条旧团队阻断自动选择，团队private阻断自动改变可见性', async () => {
    await seed({
      users: [member('alice')],
      teams: [
        { id: 'a', slug: 'one' },
        { id: 'b', slug: 'two' },
      ],
      repositories: [repo('legacy', { teamId: 'a' })],
    });
    const found = await analyze();
    expect(found.blocked).toBe(true);
    expect(found.report.legacySharedTeamId).toBeNull();
    expect(codes(found.report.blockers)).toEqual([
      'multiple_legacy_teams',
      'legacy_team_private',
    ]);
    expect(found.report.blockers[0].count).toBe(2);
    expect(
      (
        await db
          .prepare("SELECT visibility FROM repositories WHERE id='legacy'")
          .first()
      )?.visibility
    ).toBe('private');
  });

  it('检查用户名之间及跨团队slug的大小写归一冲突，不自动挑一方覆盖', async () => {
    await seed({
      users: [
        member('alice', { username: 'Alice' }),
        member('bob', { username: 'alice' }),
      ],
      teams: [{ id: 'shared', slug: 'alice' }],
    });
    const found = await analyze();
    expect(found.blocked).toBe(true);
    const conflict = found.report.blockers.find(
      (issue) => issue.code === 'namespace_collision'
    )!;
    expect(conflict.count).toBe(2);
    expect(conflict.samples).toEqual([
      { id: 'bob', relatedId: 'alice' },
      { id: 'shared', relatedId: 'alice' },
    ]);
  });

  it('无username和null role保留成员身份，个人仓库无可寻址owner时阻断', async () => {
    await seed({
      users: [member('alice', { username: null, role: null })],
      repositories: [repo('private')],
    });
    const found = await analyze();
    expect(found.snapshot.users[0].role).toBeNull();
    expect(codes(found.report.warnings)).toContain('member_without_username');
    expect(codes(found.report.blockers)).toContain(
      'unaddressable_personal_repository'
    );
    expect(codes(found.report.blockers)).not.toContain(
      'unsupported_member_role'
    );
  });

  it('封禁owner/协作者仅提示保留休眠来源，正常Agent自有配置仓库不误当人类admin授权', async () => {
    await seed({
      users: [
        member('alice', { banned: 1 }),
        member('bob', { banned: 1 }),
        member('reviewer'),
      ],
      repositories: [
        repo('private'),
        repo('reviewer-config', { ownerId: 'reviewer' }),
      ],
      collaborators: [{ repositoryId: 'private', userId: 'bob' }],
      agents: [{ userId: 'reviewer', repositoryId: 'reviewer-config' }],
    });
    const found = await analyze();
    expect(found.blocked).toBe(false);
    expect(codes(found.report.warnings)).toEqual(
      expect.arrayContaining([
        'banned_repository_owner',
        'banned_collaborator',
        'recovery_credentials_unverified',
      ])
    );
    expect(found.report.compatibility.legacyCollaboratorCount).toBe(1);
    expect(found.snapshot.users.find((row) => row.id === 'bob')?.banned).toBe(
      1
    );
  });

  it('Agent错误的人类协作授权或非配置仓库所有权需人工处理，不能默转普通角色', async () => {
    await seed({
      users: [member('alice'), member('reviewer', { role: 'admin' })],
      repositories: [repo('private'), repo('alien', { ownerId: 'reviewer' })],
      collaborators: [{ repositoryId: 'private', userId: 'reviewer' }],
      agents: [{ userId: 'reviewer', repositoryId: null }],
    });
    const found = await analyze();
    expect(codes(found.report.blockers)).toEqual([
      'unexpected_agent_repository_owner',
      'agent_collaborator',
    ]);
    expect(found.report.counts.activeHumanSiteAdmins).toBe(0);
  });

  it('孤儿引用在由真实快照导出的异常输入中逐项阻断，不把缺失成员当有效权限', async () => {
    await seed({
      users: [member('alice')],
      repositories: [repo('private')],
      collaborators: [{ repositoryId: 'private', userId: 'alice' }],
    });
    // The production FKs prevent planting an orphan directly. Corrupt/exported snapshots are still untrusted.
    const snapshot = JSON.parse(await raw());
    snapshot.repositories[0].ownerId = 'gone-owner';
    snapshot.repositories[0].teamId = 'gone-team';
    snapshot.collaborators[0] = {
      repositoryId: 'gone-repo',
      userId: 'gone-person',
    };
    snapshot.agents = [{ userId: 'gone-agent', repositoryId: 'gone-config' }];
    const found = analyzeAccessSnapshot(snapshot);
    expect(codes(found.report.blockers)).toEqual(
      expect.arrayContaining([
        'missing_repository_owner',
        'missing_repository_team',
        'missing_collaborator_repository',
        'missing_collaborator_user',
        'missing_agent_user',
        'missing_agent_repository',
      ])
    );
  });

  it('Agent配置反向引用人类所有或团队仓库均阻断，null引用仍独立合法', async () => {
    await seed({
      users: [member('alice'), member('reviewer'), member('team-reviewer')],
      teams: [{ id: 'shared', slug: 'platform' }],
      repositories: [
        repo('human-owned'),
        repo('team-config', {
          ownerId: 'team-reviewer',
          teamId: 'shared',
          visibility: 'internal',
        }),
      ],
      agents: [
        { userId: 'reviewer', repositoryId: 'human-owned' },
        { userId: 'team-reviewer', repositoryId: 'team-config' },
      ],
    });
    const found = await analyze();
    const issue = found.report.blockers.find(
      (problem) => problem.code === 'invalid_agent_configuration_repository'
    )!;
    expect(found.blocked).toBe(true);
    expect(issue.count).toBe(2);
    expect(issue.samples).toEqual([
      { id: 'reviewer', relatedId: 'human-owned' },
      { id: 'team-reviewer', relatedId: 'team-config' },
    ]);
  });

  it('超过100对象使用单一有界SQL快照，129条协作者完整计数且不生成参数列表', async () => {
    const people = Array.from({ length: 129 }, (_, i) => member(`member${i}`));
    await seed({
      users: [member('alice'), ...people],
      repositories: [repo('private')],
      collaborators: people.map((person) => ({
        repositoryId: 'private',
        userId: person.id,
      })),
    });
    const found = await analyze();
    expect(found.blocked).toBe(false);
    expect(found.report.compatibility.legacyCollaboratorCount).toBe(129);
    expect(accessPreflightQuery().params).toHaveLength(3);
    expect(
      new TextEncoder().encode(accessPreflightQuery().sql).length
    ).toBeLessThan(100_000);
  });

  it('1001哨兵拒绝整次预检，不将截断前缀当精确全库清单', async () => {
    await seed({
      users: [member('alice')],
      repositories: Array.from({ length: ACCESS_PREFLIGHT_LIMIT + 1 }, (_, i) =>
        repo(`repo${i}`)
      ),
    });
    const snapshot = await raw();
    expect(JSON.parse(snapshot).repositories).toHaveLength(
      ACCESS_PREFLIGHT_LIMIT + 1
    );
    expect(() => analyzeAccessSnapshot(snapshot)).toThrow(
      '1000-row snapshot limit'
    );
  });

  it('样例有界但异常总数不因20条展示上限而漏记', async () => {
    await seed({
      users: [member('alice')],
      teams: [{ id: 'shared', slug: 'platform' }],
      repositories: Array.from({ length: 27 }, (_, i) =>
        repo(`repo${i}`, { teamId: 'shared' })
      ),
    });
    const found = await analyze();
    const problem = found.report.blockers.find(
      (issue) => issue.code === 'legacy_team_private'
    )!;
    expect(problem.count).toBe(27);
    expect(problem.samples).toHaveLength(20);
  });

  it('绑定安装身份比较不返回nonce，手动目标允许无marker但拒绝多marker', async () => {
    const expected = {
      id: 'installation',
      ownershipNonce: 'private-marker-do-not-print',
    };
    await db
      .prepare(
        'INSERT INTO install_state(installation_id,ownership_nonce,updated_at) VALUES (?,?,0)'
      )
      .bind(expected.id, expected.ownershipNonce)
      .run();
    const payload = await raw(expected);
    expect(payload).not.toContain(expected.ownershipNonce);
    expect(payload).not.toContain('ownershipNonce');
    expect(analyzeAccessSnapshot(payload).blocked).toBe(false);
    await expect(
      analyze({ ...expected, ownershipNonce: 'wrong' })
    ).rejects.toThrow('marker mismatch');
    await db
      .prepare(
        "INSERT INTO install_state(installation_id,ownership_nonce,updated_at) VALUES ('other','another-private-marker',0)"
      )
      .run();
    await expect(analyze()).rejects.toThrow('marker mismatch');
  });

  it('相关新列或ACL新表不能被旧collab=true误解释成可回填write', async () => {
    await seed({
      users: [member('alice')],
      repositories: [repo('private')],
      collaborators: [{ repositoryId: 'private', userId: 'alice' }],
    });
    await db.exec('ALTER TABLE repository_collaborators ADD COLUMN role text');
    try {
      await expect(analyze()).rejects.toThrow('unsupported schema');
    } finally {
      await db.exec('ALTER TABLE repository_collaborators DROP COLUMN role');
    }
    await db.exec('CREATE TABLE team_members(team_id text, user_id text)');
    try {
      await expect(analyze()).rejects.toThrow('new ACL schema');
    } finally {
      await db.exec('DROP TABLE team_members');
    }
  });

  it('虚拟生成role列也属于未知ACL，不能因table_info隐藏该列而建议write回填', async () => {
    await seed({
      users: [member('alice')],
      repositories: [repo('private')],
      collaborators: [{ repositoryId: 'private', userId: 'alice' }],
    });
    await db.exec(
      "ALTER TABLE repository_collaborators ADD COLUMN role TEXT GENERATED ALWAYS AS ('read') VIRTUAL"
    );
    try {
      const old = await db
        .prepare(
          "SELECT name FROM pragma_table_info('repository_collaborators')"
        )
        .all<{ name: string }>();
      expect(old.results.map((column) => column.name)).not.toContain('role');
      await expect(analyze()).rejects.toThrow('unsupported schema');
    } finally {
      await db.exec('ALTER TABLE repository_collaborators DROP COLUMN role');
    }
  });

  it('超长字段和JSON转义放大在SQL投影时标记拒绝，不静默裁剪后成功', async () => {
    await seed({
      users: [member('alice')],
      repositories: [repo('private', { name: '界'.repeat(40) })],
    });
    let snapshot = JSON.parse(await raw());
    expect(snapshot.invalidFields).toBe(1);
    expect(snapshot.repositories[0].name).toBeNull();
    expect(() => analyzeAccessSnapshot(snapshot)).toThrow('invalid/oversized');
    await db
      .prepare('UPDATE repositories SET name = ?')
      .bind('"'.repeat(70))
      .run();
    snapshot = JSON.parse(await raw());
    expect(snapshot.invalidFields).toBe(1);
    expect(snapshot.repositories[0].name).toBeNull();
  });

  it('banned非0/1/null在SQL失败关闭，未知role不升级管理员', async () => {
    await seed({ users: [member('alice', { banned: 2 })] });
    await expect(analyze()).rejects.toThrow('invalid/oversized');
    await db.prepare("UPDATE users SET banned=0,role='future-admin'").run();
    const found = await analyze();
    expect(found.report.counts.activeHumanSiteAdmins).toBe(0);
    expect(codes(found.report.blockers)).toContain('unsupported_member_role');
  });

  it('稳定快照不包含邮箱、密码或marker秘密，相关字段变化仍被完整观察', async () => {
    await seed({
      users: [member('alice'), member('bob')],
      repositories: [repo('private')],
    });
    const before = (await analyze()).snapshot;
    await db
      .prepare(
        "UPDATE users SET email='private-address@secret.invalid',name='private display name' WHERE id='bob'"
      )
      .run();
    const after = (await analyze()).snapshot;
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('private-address');
    await db.prepare("UPDATE repositories SET visibility='public'").run();
    expect((await analyze()).snapshot).not.toEqual(before);
    const shuffled = { ...after, users: [...after.users].reverse() };
    expect(analyzeAccessSnapshot(shuffled).snapshot).toEqual(after);
  });

  it('缺字段、额外键、重复身份、非法visibility、view替代或过大JSON均失败关闭', async () => {
    await seed({ users: [member('alice')], repositories: [repo('private')] });
    const original = JSON.parse(await raw());
    const variants = [
      { ...original, marker: null },
      { ...original, users: [...original.users, original.users[0]] },
      {
        ...original,
        repositories: [{ ...original.repositories[0], visibility: 'future' }],
      },
      { ...original, tableTypesValid: false },
      { ...original, extra: 'unexpected' },
    ];
    for (const variant of variants)
      expect(() => analyzeAccessSnapshot(variant)).toThrow('preflight refused');
    expect(() =>
      analyzeAccessSnapshot(' '.repeat(ACCESS_PREFLIGHT_MAX_BYTES + 1))
    ).toThrow('bounded JSON');
  });
});

const compatDb = env.DB;
async function compatRaw() {
  const query = accessPreflightQuery(undefined, 'runtime-bridge-v1');
  const row = await compatDb
    .prepare(query.sql)
    .bind(...query.params)
    .first<{ snapshot: string }>();
  return JSON.parse(row!.snapshot);
}
async function compatSeed() {
  await compatDb.batch([
    compatDb.prepare(
      "INSERT INTO users(id,name,email,username,role) VALUES('owner','Owner','secret@example.invalid','owner','admin'),('member','Member','member-secret@example.invalid','member','user')"
    ),
    compatDb.prepare(
      "INSERT INTO teams(id,slug,name,created_at) VALUES('stable-team','shared','Shared',0)"
    ),
    compatDb.prepare(
      "INSERT INTO repositories(id,owner_id,team_id,name,visibility,artifacts_name,created_at,updated_at) VALUES('repo','owner','stable-team','repo','public','r_repo',0,0)"
    ),
    compatDb.prepare(
      "INSERT INTO repository_collaborators(repository_id,user_id,created_at) VALUES('repo','member',0)"
    ),
  ]);
}
describe('版本感知兼容schema只读预检（真实D1）', () => {
  it('桥接快照包含运行时底线，历史 compat 查询不能忽略新表', async () => {
    const found = analyzeAccessSnapshot(await compatRaw());
    expect(found.report.runtime).toEqual({
      minimumProtocol: 1,
      schemaMode: 'compat-v1',
      rolePublishingEnabled: false,
      revision: 0,
    });
    const oldQuery = accessPreflightQuery(undefined, 'compat-v1');
    const old = await compatDb
      .prepare(oldQuery.sql)
      .bind(...oldQuery.params)
      .first<{ snapshot: string }>();
    expect(() => analyzeAccessSnapshot(old!.snapshot)).toThrow(
      'preflight refused'
    );
  });
  it.each(['missing', 'changed', 'extra'] as const)(
    '运行时触发器 %s 由同条最终快照拒绝',
    async (kind) => {
      const trigger = ACCESS_RUNTIME_TRIGGERS.find(
        (row) => row.name === 'cloudforge_runtime_state_update_v1'
      )!;
      if (kind === 'extra')
        await compatDb.exec(
          'CREATE TRIGGER cloudforge_runtime_extra_v1 AFTER UPDATE ON users BEGIN SELECT 1; END'
        );
      else {
        await compatDb.exec(`DROP TRIGGER ${trigger.name}`);
        if (kind === 'changed')
          await compatDb.exec(
            `CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON access_runtime_state BEGIN SELECT 1; END`
          );
      }
      try {
        await expect(compatRaw().then(analyzeAccessSnapshot)).rejects.toThrow(
          'integrity'
        );
      } finally {
        if (kind === 'extra')
          await compatDb.exec('DROP TRIGGER cloudforge_runtime_extra_v1');
        else {
          if (kind === 'changed')
            await compatDb.exec(`DROP TRIGGER ${trigger.name}`);
          await compatDb.prepare(trigger.sql).run();
        }
      }
    }
  );
  it('运行时高代数阻断；缺行、重复、未知mode与角色启用不解释成兼容', async () => {
    const snapshot = await compatRaw();
    const raised = structuredClone(snapshot);
    raised.runtime.state[0].minimumProtocol = 2;
    const found = analyzeAccessSnapshot(raised);
    expect(found.blocked).toBe(true);
    expect(codes(found.report.blockers)).toContain(
      'unsupported_runtime_protocol'
    );
    for (const mutate of [
      (value: typeof snapshot) => {
        value.runtime.state = [];
      },
      (value: typeof snapshot) => {
        value.runtime.state.push({ ...value.runtime.state[0] });
      },
      (value: typeof snapshot) => {
        value.runtime.state[0].schemaMode = 'roles-v2';
      },
      (value: typeof snapshot) => {
        value.runtime.state[0].rolePublishingEnabled = 1;
      },
      (value: typeof snapshot) => {
        value.runtime.state[0].revision = 9007199254740992;
      },
    ]) {
      const changed = structuredClone(snapshot);
      mutate(changed);
      expect(() => analyzeAccessSnapshot(changed)).toThrow('preflight refused');
    }
  });
  it('发现legacy与compat-v1；完整新schema检查约束、trigger、稳定团队指针与claims', async () => {
    await compatSeed();
    const discovery = accessPreflightDiscoveryQuery();
    for (const [database, version] of [
      [db, 'legacy'],
      [compatDb, 'runtime-bridge-v1'],
    ] as const) {
      const row = await database
        .prepare(discovery.sql)
        .first<{ schemaDiscovery: string }>();
      expect(classifyAccessSchema(row!.schemaDiscovery)).toBe(version);
    }
    const before = await compatDb
      .prepare('SELECT * FROM access_control_state')
      .first<{ generation: number }>();
    const found = analyzeAccessSnapshot(await compatRaw());
    expect(found.blocked).toBe(false);
    expect(found.report.schemaVersion).toBe('runtime-bridge-v1');
    expect(found.report.accessGeneration).toBe(before!.generation);
    expect(found.report.legacySharedTeamId).toBe('stable-team');
    expect(found.snapshot.compat?.claims).toHaveLength(3);
    expect(found.report.publicRepositoryIds).toEqual(['repo']);
    expect(found.rolePublishingAllowed).toBe(false);
    expect(found.report.compatibility.rollbackSafe).toBe(false);
    expect(JSON.stringify(found)).not.toContain('secret@example.invalid');
    expect(
      await compatDb.prepare('SELECT * FROM access_control_state').first()
    ).toEqual(before);
    const query = accessPreflightQuery(undefined, 'runtime-bridge-v1');
    expect(query.params.length).toBeLessThan(100);
    expect(new TextEncoder().encode(query.sql).length).toBeLessThan(100_000);
  });
  it('Windows CRLF迁移保留完整trigger正文，不因换行形式误拒绝', async () => {
    const trigger = ACCESS_TRIGGERS.find(
      (row) => row.name === 'cloudforge_access_claim_update_v1'
    )!;
    await compatDb.exec(`DROP TRIGGER ${trigger.name}`);
    try {
      await compatDb.prepare(trigger.sql.replaceAll('\n', '\r\n')).run();
      expect(analyzeAccessSnapshot(await compatRaw()).blocked).toBe(false);
    } finally {
      await compatDb.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
      await compatDb.prepare(trigger.sql).run();
    }
  });
  it.each(['missing', 'changed', 'extra'])(
    'managed trigger %s使完整快照失败关闭',
    async (kind) => {
      const trigger = ACCESS_TRIGGERS.find(
        (row) => row.name === 'cloudforge_access_claim_update_v1'
      )!;
      if (kind === 'extra')
        await compatDb.exec(
          'CREATE TRIGGER CLOUDFORGE_ACCESS_EXTRA_V9 AFTER UPDATE ON teams BEGIN SELECT 1; END'
        );
      else {
        await compatDb.exec(`DROP TRIGGER ${trigger.name}`);
        if (kind === 'changed')
          await compatDb.exec(
            `CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON namespace_claims BEGIN SELECT 1; END`
          );
      }
      try {
        await expect(compatRaw().then(analyzeAccessSnapshot)).rejects.toThrow(
          'integrity'
        );
      } finally {
        if (kind === 'extra')
          await compatDb.exec('DROP TRIGGER CLOUDFORGE_ACCESS_EXTRA_V9');
        else {
          if (kind === 'changed')
            await compatDb.exec(`DROP TRIGGER ${trigger.name}`);
          await compatDb.prepare(trigger.sql).run();
        }
      }
    }
  );
  it('缺失或额外namespace claim、坏指针及不支持的role/membership均阻断', async () => {
    await compatSeed();
    const original = await compatRaw();
    const variants: [(data: typeof original) => void, string][] = [
      [
        (data) => {
          data.compat.claims.pop();
        },
        'namespace_claim_missing',
      ],
      [
        (data) => {
          data.compat.claims.push({
            slug: 'stray',
            kind: 'user',
            subjectId: 'absent',
          });
        },
        'namespace_claim_mismatch',
      ],
      [
        (data) => {
          data.compat.state[0].legacySharedTeamId = 'absent';
        },
        'invalid_legacy_team_pointer',
      ],
      [
        (data) => {
          data.compat.collaborators[0].role = 'read';
        },
        'unsupported_collaborator_role',
      ],
      [
        (data) => {
          data.compat.teams[0].membershipMode = 'explicit';
        },
        'unsupported_team_membership',
      ],
    ];
    for (const [change, code] of variants) {
      const value = structuredClone(original);
      change(value);
      const found = analyzeAccessSnapshot(value);
      expect(found.blocked).toBe(true);
      expect(codes(found.report.blockers)).toContain(code);
    }
  });
  it.each([null, -1, 1.5, 9007199254740992])(
    '拒绝非法代数与修订%s',
    async (value) => {
      await compatSeed();
      const original = await compatRaw();
      for (const target of ['state', 'teams', 'collaborators']) {
        const changed = structuredClone(original);
        changed.compat[target][0][
          target === 'state' ? 'generation' : 'revision'
        ] = value;
        expect(() => analyzeAccessSnapshot(changed)).toThrow(
          'generation/revision'
        );
      }
    }
  );
  it('schema发现后再变化由最终快照重新核验并拒绝', async () => {
    const discovery = accessPreflightDiscoveryQuery();
    const initial = await compatDb
      .prepare(discovery.sql)
      .first<{ schemaDiscovery: string }>();
    expect(classifyAccessSchema(initial!.schemaDiscovery)).toBe(
      'runtime-bridge-v1'
    );
    await compatDb.exec('CREATE TABLE team_members(team_id TEXT,user_id TEXT)');
    try {
      await expect(compatRaw().then(analyzeAccessSnapshot)).rejects.toThrow(
        'new ACL schema'
      );
    } finally {
      await compatDb.exec('DROP TABLE team_members');
    }
  });
  it('全部claims数量也使用1001哨兵，不接受截断前缀', async () => {
    await compatDb
      .prepare(
        `INSERT INTO users(id,name,email,username) SELECT 'u'||value,'User','u'||value||'@test.invalid','u'||value FROM json_each(?)`
      )
      .bind(JSON.stringify(Array.from({ length: 1001 }, (_, i) => i)))
      .run();
    const value = await compatRaw();
    expect(value.compat.claims).toHaveLength(1001);
    expect(() => analyzeAccessSnapshot(value)).toThrow(
      '1000-row snapshot limit'
    );
  });
});
