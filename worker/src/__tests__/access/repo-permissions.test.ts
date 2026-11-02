// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  repositories,
  repositoryCollaborators,
  teams,
} from '../../db/app.schema';
import { users } from '../../db/auth.schema';
import { schema } from '../../db/schema';
import {
  can,
  permissionsOf,
  withTokenScope,
  type RepoCapability,
  type RepoPermissions,
} from '../../repositories/permissions';
import {
  permissionsFor,
  permissionsForMany,
  visibleTo,
} from '../../repositories/service';
import { makeEnv } from '../helpers/app';

const access = {
  none: { read: false, write: false, admin: false },
  read: { read: true, write: false, admin: false },
  write: { read: true, write: true, admin: false },
  admin: { read: true, write: true, admin: true },
} satisfies Record<string, RepoPermissions>;
type Access = keyof typeof access;

// This acceptance matrix is the pre-role product contract, independent of capability implementation.
const writeCapabilities: RepoCapability[] = [
  'push',
  'manageIssues',
  'editPullMetadata',
  'managePulls',
  'runActions',
  'publishStatus',
  'publishRelease',
];
const adminCapabilities: RepoCapability[] = [
  'editSettings',
  'manageProtection',
  'manageAccess',
  'manageAgents',
  'manageWebhooks',
  'manageActionsSecrets',
  'manageActionsVariables',
  'manageDeployTokens',
  'deleteRepository',
  'deleteIssues',
];

async function fixture() {
  const t = makeEnv();
  const db = drizzle(t.env.DB, { schema });
  await db.insert(users).values(
    [
      'site-admin',
      'owner',
      'creator',
      'collaborator',
      'stranger',
      'no-role',
    ].map((id) => ({
      id,
      name: id,
      username: id,
      email: `${id}@example.com`,
      role: id === 'site-admin' ? 'admin' : id === 'no-role' ? null : 'user',
    }))
  );
  await db.insert(teams).values({
    id: 'team',
    name: 'Shared',
    slug: 'shared',
    createdAt: new Date(),
  });
  const rows = [
    {
      id: 'personal-private',
      ownerId: 'owner',
      visibility: 'private',
      teamId: null,
    },
    {
      id: 'personal-internal',
      ownerId: 'owner',
      visibility: 'internal',
      teamId: null,
    },
    {
      id: 'personal-public',
      ownerId: 'owner',
      visibility: 'public',
      teamId: null,
    },
    {
      id: 'team-internal',
      ownerId: 'creator',
      visibility: 'internal',
      teamId: 'team',
    },
    {
      id: 'team-public',
      ownerId: 'creator',
      visibility: 'public',
      teamId: 'team',
    },
  ] as const;
  await db.insert(repositories).values(
    rows.map((row) => ({
      ...row,
      name: row.id,
      artifactsName: `r_${row.id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  );
  await db.insert(repositoryCollaborators).values(
    ['personal-private', 'team-internal'].map((repositoryId) => ({
      userId: 'collaborator',
      repositoryId,
      createdAt: new Date(),
    }))
  );
  const people = await db.select().from(users).all();
  const repos = await db.select().from(repositories).all();
  return {
    t,
    db,
    people: new Map(people.map((person) => [person.id, person])),
    repos,
    ids: rows.map((row) => row.id),
  };
}

describe('阶段A仓库权限兼容内核', () => {
  it('历史team-private纯规则仍为成员可读，兼容schema拒绝新建该异常行', async () => {
    const f = await fixture();
    const team = f.repos.find((row) => row.id === 'team-internal')!;
    const legacy = { ...team, visibility: 'private' as const };
    const person = f.people.get('stranger')!;
    expect(permissionsOf(legacy, person, false)).toEqual(access.read);
    expect(await permissionsFor(f.db, legacy, person)).toEqual(access.read);
    expect(
      (await permissionsForMany(f.db, [legacy], person)).get(legacy.id)
    ).toEqual(access.read);
    await expect(
      f.t.env.DB.prepare(
        `INSERT INTO repositories(id,owner_id,team_id,visibility,name,artifacts_name,created_at,updated_at) VALUES (?,?,?,'private',?,?,0,0)`
      )
        .bind(
          'legacy-private',
          team.ownerId,
          team.teamId,
          'legacy-private',
          'r_legacy-private'
        )
        .run()
    ).rejects.toThrow('CloudForge repository access conflict');
  });

  it('单项、批量和SQL可读集合保持既有身份/可见性矩阵，团队创建者不被误当普通成员', async () => {
    const f = await fixture();
    const cases: { person?: string; banned?: boolean; expected: Access[] }[] = [
      {
        person: 'site-admin',
        expected: ['admin', 'admin', 'admin', 'admin', 'admin'],
      },
      {
        person: 'owner',
        expected: ['admin', 'admin', 'admin', 'read', 'read'],
      },
      {
        person: 'creator',
        expected: ['none', 'read', 'read', 'admin', 'admin'],
      },
      {
        person: 'collaborator',
        expected: ['write', 'read', 'read', 'write', 'read'],
      },
      {
        person: 'stranger',
        expected: ['none', 'read', 'read', 'read', 'read'],
      },
      {
        person: 'no-role',
        expected: ['none', 'read', 'read', 'read', 'read'],
      },
      {
        person: 'site-admin',
        banned: true,
        expected: ['none', 'none', 'read', 'none', 'read'],
      },
      {
        person: 'owner',
        banned: true,
        expected: ['none', 'none', 'read', 'none', 'read'],
      },
      {
        person: 'collaborator',
        banned: true,
        expected: ['none', 'none', 'read', 'none', 'read'],
      },
      { expected: ['none', 'none', 'read', 'none', 'read'] },
    ];
    for (const row of cases) {
      const user = row.person
        ? {
            ...f.people.get(row.person)!,
            ...(row.banned ? { banned: true } : {}),
          }
        : undefined;
      const many = await permissionsForMany(f.db, f.repos, user);
      const visible = await f.db
        .select({ id: repositories.id })
        .from(repositories)
        .where(visibleTo(user))
        .all();
      const expectedVisible: string[] = [];
      for (const [index, id] of f.ids.entries()) {
        const repo = f.repos.find((record) => record.id === id)!;
        const expected = access[row.expected[index]];
        expect(
          await permissionsFor(f.db, repo, user),
          `${row.person ?? 'anonymous'} ${id}`
        ).toEqual(expected);
        expect(many.get(id)).toEqual(expected);
        // Notification candidates can use minimal member fields without inventing names/emails.
        const minimal = user && {
          id: user.id,
          role: user.role,
          banned: user.banned,
        };
        expect(
          permissionsOf(
            repo,
            minimal,
            user?.id === 'collaborator' &&
              ['personal-private', 'team-internal'].includes(id)
          )
        ).toEqual(expected);
        if (expected.read) expectedVisible.push(id);
      }
      expect(visible.map((repo) => repo.id).sort()).toEqual(
        expectedVisible.sort()
      );
    }
  });

  it('129仓库的批量权限仅读取一次真实D1协作集合，且与可见集合一致', async () => {
    const f = await fixture();
    const extra = Array.from({ length: 129 }, (_, index) => ({
      id: `bulk-${index.toString().padStart(3, '0')}`,
      owner: 'owner',
      visibility:
        index % 3 === 0 ? 'public' : index % 3 === 1 ? 'internal' : 'private',
    }));
    await f.t.env.DB.prepare(
      `INSERT INTO repositories (id,owner_id,name,visibility,artifacts_name,created_at,updated_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.owner'),json_extract(value,'$.id'),
      json_extract(value,'$.visibility'),'r_'||json_extract(value,'$.id'),0,0 FROM json_each(?)`
    )
      .bind(JSON.stringify(extra))
      .run();
    const writableIds = extra
      .filter((_, index) => index % 5 === 0)
      .map((repo) => repo.id);
    await f.t.env.DB.prepare(
      `INSERT INTO repository_collaborators(repository_id,user_id,created_at)
      SELECT value,'stranger',0 FROM json_each(?)`
    )
      .bind(JSON.stringify(writableIds))
      .run();
    let prepared = 0;
    const counted = new Proxy(f.t.env.DB, {
      get(target, key, receiver) {
        if (key === 'prepare')
          return (statement: string) => {
            prepared++;
            return target.prepare(statement);
          };
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const db = drizzle(counted, { schema });
    const user = f.people.get('stranger')!;
    const rows = (await f.db.select().from(repositories).all()).filter((repo) =>
      repo.id.startsWith('bulk-')
    );
    const many = await permissionsForMany(db, [...rows, rows[0]], user);
    expect(prepared).toBe(1);
    expect(many.size).toBe(129);
    const writable = new Set(writableIds);
    for (const repo of extra)
      expect(many.get(repo.id)).toEqual(
        writable.has(repo.id)
          ? access.write
          : repo.visibility === 'private'
            ? access.none
            : access.read
      );
    const visible = await f.db
      .select({ id: repositories.id })
      .from(repositories)
      .where(visibleTo(user))
      .all();
    expect(
      visible
        .filter((repo) => repo.id.startsWith('bulk-'))
        .map((repo) => repo.id)
        .sort()
    ).toEqual(
      extra
        .filter(
          (repo) => repo.visibility !== 'private' || writable.has(repo.id)
        )
        .map((repo) => repo.id)
        .sort()
    );
    prepared = 0;
    await permissionsForMany(db, rows, f.people.get('owner'));
    expect(prepared).toBe(0);
  });

  it('协作者撤销和当前成员降权/封禁后不复用旧权限结果', async () => {
    const f = await fixture();
    const repo = f.repos.find((record) => record.id === 'personal-private')!;
    const user = f.people.get('collaborator')!;
    expect(await permissionsFor(f.db, repo, user)).toEqual(access.write);
    await f.db
      .delete(repositoryCollaborators)
      .where(
        and(
          eq(repositoryCollaborators.userId, user.id),
          eq(repositoryCollaborators.repositoryId, repo.id)
        )
      );
    expect(await permissionsFor(f.db, repo, user)).toEqual(access.none);
    expect((await permissionsForMany(f.db, [repo], user)).get(repo.id)).toEqual(
      access.none
    );
    expect(
      await f.db
        .select()
        .from(repositories)
        .where(and(eq(repositories.id, repo.id), visibleTo(user)))
    ).toEqual([]);
    const current = async () =>
      (await f.db.select().from(users).where(eq(users.id, 'stranger')).get())!;
    await f.db
      .update(users)
      .set({ role: 'admin' })
      .where(eq(users.id, 'stranger'));
    expect(await permissionsFor(f.db, repo, await current())).toEqual(
      access.admin
    );
    await f.db
      .update(users)
      .set({ role: 'user' })
      .where(eq(users.id, 'stranger'));
    expect(await permissionsFor(f.db, repo, await current())).toEqual(
      access.none
    );
    await f.db
      .update(users)
      .set({ role: 'admin', banned: true })
      .where(eq(users.id, 'stranger'));
    expect(await permissionsFor(f.db, repo, await current())).toEqual(
      access.none
    );
  });

  it('命名能力保持write与admin分界，不把低风险设置或删他人Issue提前开放给协作者', () => {
    for (const capability of writeCapabilities) {
      expect(can(access.read, capability)).toBe(false);
      expect(can(access.write, capability)).toBe(true);
    }
    for (const capability of adminCapabilities) {
      expect(can(access.write, capability)).toBe(false);
      expect(can(access.admin, capability)).toBe(true);
    }
    expect(can(access.none, 'read')).toBe(false);
    expect(can(access.read, 'read')).toBe(true);
  });

  it.each(['none', 'read', 'write', 'admin'] as const)(
    'read scope限制%s身份的全部命名写能力，保留原读取与DTO形状',
    (level) => {
      const original = { ...access[level] };
      const capped = withTokenScope(original, 'read');
      expect(capped).toEqual({
        read: original.read,
        write: false,
        admin: false,
      });
      expect(Object.keys(capped).sort()).toEqual(['admin', 'read', 'write']);
      expect(can(capped, 'read')).toBe(original.read);
      for (const capability of [...writeCapabilities, ...adminCapabilities])
        expect(can(capped, capability)).toBe(false);
      expect(original).toEqual(access[level]);
      for (const scope of ['write', null, undefined])
        expect(withTokenScope(original, scope)).toEqual(original);
    }
  );
});
