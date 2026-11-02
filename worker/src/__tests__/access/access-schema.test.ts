// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addMember, bootstrapAdmin, call, makeEnv } from '../helpers/app';

const run = (sql: string, ...params: (string | number | null)[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .run();
const all = <T>(sql: string, ...params: (string | number | null)[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .all<T>()
    .then((result) => result.results);
const state = () =>
  env.DB.prepare(
    'SELECT id, generation, legacy_shared_team_id AS legacy FROM access_control_state'
  ).first<{ id: number; generation: number; legacy: string | null }>();
const claims = () =>
  all<{ slug: string; kind: string; subject: string }>(
    'SELECT slug, kind, subject_id AS subject FROM namespace_claims ORDER BY slug'
  );
const user = (
  id: string,
  username: string | null = id,
  email = `${id}@example.com`
) =>
  run(
    'INSERT INTO users (id, name, email, username, role) VALUES (?, ?, ?, ?, ?)',
    id,
    id,
    email,
    username,
    'user'
  );
const team = (id = 'legacy-team', slug = 'platform') =>
  run(
    'INSERT INTO teams (id, slug, name, created_at) VALUES (?, ?, ?, 0)',
    id,
    slug,
    slug
  );
const repo = (
  id = 'repo',
  owner = 'owner',
  teamId: string | null = null,
  visibility = 'private'
) =>
  run(
    'INSERT INTO repositories (id, owner_id, team_id, name, artifacts_name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
    id,
    owner,
    teamId,
    id,
    `r_${id}`,
    visibility
  );
const collaboration = (repository = 'repo', person = 'member') =>
  run(
    'INSERT INTO repository_collaborators (repository_id, user_id, created_at) VALUES (?, ?, 0)',
    repository,
    person
  );
async function collaboratorsWorld() {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users(id,name,email,username) VALUES(?,?,?,?)'
    ).bind('owner', 'Owner', 'owner@example.com', 'owner'),
    env.DB.prepare(
      'INSERT INTO users(id,name,email,username) VALUES(?,?,?,?)'
    ).bind('member', 'Member', 'member@example.com', 'member'),
  ]);
  await repo();
}

describe('阶段B兼容schema与声明触发器（真实D1）', () => {
  it('保留唯一持久state，正常清理后指针为空且generation从不当作缺省零', async () => {
    const rows = await all<{
      id: number;
      generation: number;
      legacy_shared_team_id: string | null;
    }>('SELECT * FROM access_control_state');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(Number.isSafeInteger(rows[0].generation)).toBe(true);
    expect(rows[0].generation).toBeGreaterThanOrEqual(0);
    expect(rows[0].legacy_shared_team_id).toBeNull();
    expect(await claims()).toEqual([]);
  });

  it('用户与团队的同值id是不同主体，slug仍全局唯一', async () => {
    const before = (await state())!;
    await user('same-id', 'Alice');
    await team('same-id', 'platform');
    expect(await claims()).toEqual([
      { slug: 'alice', kind: 'user', subject: 'same-id' },
      { slug: 'platform', kind: 'team', subject: 'same-id' },
    ]);
    expect(await state()).toEqual({
      id: 1,
      generation: before.generation + 2,
      legacy: 'same-id',
    });
  });

  it('用户名改名由源行原子维护claim，仅大小写变化不错误删除活跃claim', async () => {
    await user('person', 'Alice');
    const before = (await state())!;
    await run('UPDATE users SET username = ? WHERE id = ?', 'ALICE', 'person');
    expect(await claims()).toEqual([
      { slug: 'alice', kind: 'user', subject: 'person' },
    ]);
    await run('UPDATE users SET username = ? WHERE id = ?', 'BOb', 'person');
    expect(await claims()).toEqual([
      { slug: 'bob', kind: 'user', subject: 'person' },
    ]);
    expect((await state())!.generation).toBe(before.generation + 2);
  });

  it('NULL用户名不伪造claim，注册与清除用户名正确释放旧名称', async () => {
    await user('pending', null);
    expect(await claims()).toEqual([]);
    await run('UPDATE users SET username = ? WHERE id = ?', 'Alice', 'pending');
    expect((await claims())[0].slug).toBe('alice');
    await run('UPDATE users SET username = NULL WHERE id = ?', 'pending');
    expect(await claims()).toEqual([]);
    await user('another', 'ALICE');
    expect(await claims()).toEqual([
      { slug: 'alice', kind: 'user', subject: 'another' },
    ]);
  });

  it('大小写归一后的跨主体抢名即使外层OR REPLACE也不能偷走claim', async () => {
    await team();
    const before = (await state())!;
    const recursive = await env.DB.prepare(
      'PRAGMA recursive_triggers'
    ).first<number>('recursive_triggers');
    await run('PRAGMA recursive_triggers = OFF');
    try {
      await expect(
        run(
          "INSERT OR REPLACE INTO users(id,name,email,username) VALUES('attacker','Attacker','attacker@example.com','PLATFORM')"
        )
      ).rejects.toThrow('CloudForge namespace conflict');
      expect((await claims())[0]).toEqual({
        slug: 'platform',
        kind: 'team',
        subject: 'legacy-team',
      });
      expect(await state()).toEqual(before);
      await user('alice');
      await expect(
        run(
          "UPDATE OR REPLACE teams SET slug = 'alice' WHERE id = 'legacy-team'"
        )
      ).rejects.toThrow('CloudForge namespace conflict');
      expect((await state())!.legacy).toBe('legacy-team');
      expect(await claims()).toHaveLength(2);
    } finally {
      await run(`PRAGMA recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
    }
  });

  it('源用户唯一email/id也禁止REPLACE绕过删除保护，仓库和claim均保留', async () => {
    await user('owner');
    await user('member');
    await repo();
    const before = (await state())!;
    const recursive = await env.DB.prepare(
      'PRAGMA recursive_triggers'
    ).first<number>('recursive_triggers');
    await run('PRAGMA recursive_triggers = OFF');
    try {
      await expect(
        run(
          "INSERT OR REPLACE INTO users(id,name,email,username) VALUES('replacement','X','owner@example.com','replacement')"
        )
      ).rejects.toThrow('CloudForge user identity conflict');
      await expect(
        run(
          "INSERT OR REPLACE INTO users(id,name,email,username) VALUES('owner','X','new@example.com',NULL)"
        )
      ).rejects.toThrow('CloudForge user identity conflict');
      await expect(
        run(
          "UPDATE OR REPLACE users SET email = 'owner@example.com' WHERE id = 'member'"
        )
      ).rejects.toThrow('CloudForge user identity conflict');
      expect(await all('SELECT id,owner_id FROM repositories')).toEqual([
        { id: 'repo', owner_id: 'owner' },
      ]);
      expect(await all('SELECT id FROM users ORDER BY id')).toEqual([
        { id: 'member' },
        { id: 'owner' },
      ]);
      expect(await claims()).toHaveLength(2);
      expect(await state()).toEqual(before);
    } finally {
      await run(`PRAGMA recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
    }
  });

  it('不能直接删除、改写或REPLACE活跃claim，也不能插入不存在的主体', async () => {
    await user('alice');
    const before = (await state())!;
    for (const sql of [
      "DELETE FROM namespace_claims WHERE slug='alice'",
      "UPDATE namespace_claims SET slug='other' WHERE slug='alice'",
      "UPDATE namespace_claims SET kind='team' WHERE slug='alice'",
      "INSERT OR REPLACE INTO namespace_claims(slug,kind,subject_id) VALUES('alice','user','alice')",
      "INSERT INTO namespace_claims(slug,kind,subject_id) VALUES('other','user','missing')",
    ])
      await expect(run(sql)).rejects.toThrow('CloudForge namespace conflict');
    expect(await claims()).toEqual([
      { slug: 'alice', kind: 'user', subject: 'alice' },
    ]);
    expect(await state()).toEqual(before);
  });

  it('合法共享团队创建、旧式改名和无操作更新维护pointer、revision与claim', async () => {
    await team();
    const before = (await state())!;
    expect(await all('SELECT membership_mode,revision FROM teams')).toEqual([
      { membership_mode: 'instance', revision: 0 },
    ]);
    await run(
      "UPDATE teams SET name='Platform team',slug='platform-new' WHERE id='legacy-team' AND revision=0"
    );
    expect(await all('SELECT membership_mode,revision FROM teams')).toEqual([
      { membership_mode: 'instance', revision: 1 },
    ]);
    expect(await claims()).toEqual([
      { slug: 'platform-new', kind: 'team', subject: 'legacy-team' },
    ]);
    expect(await state()).toEqual({
      ...before,
      generation: before.generation + 1,
    });
    await run(
      "UPDATE teams SET name='Platform team',slug='platform-new' WHERE id='legacy-team'"
    );
    expect(await all('SELECT revision FROM teams')).toEqual([{ revision: 1 }]);
    expect((await state())!.generation).toBe(before.generation + 1);
  });

  it('仍有仓库的团队不能删除，空团队删除与随后新建有明确的合法生命周期', async () => {
    await user('owner');
    await team();
    await repo('team-repo', 'owner', 'legacy-team', 'internal');
    await expect(
      run("DELETE FROM teams WHERE id='legacy-team'")
    ).rejects.toThrow();
    expect((await state())!.legacy).toBe('legacy-team');
    await run("DELETE FROM repositories WHERE id='team-repo'");
    const before = (await state())!;
    await run("DELETE FROM teams WHERE id='legacy-team'");
    expect(await state()).toEqual({
      id: 1,
      generation: before.generation + 1,
      legacy: null,
    });
    expect(await claims()).toEqual([
      { slug: 'owner', kind: 'user', subject: 'owner' },
    ]);
    await team('replacement-team', 'platform-two');
    expect((await state())!.legacy).toBe('replacement-team');
    expect(await all('SELECT id FROM repositories')).toEqual([]);
  });

  it('只有一个instance团队，explicit及多团队即使关闭CHECK仍失败', async () => {
    await run('PRAGMA ignore_check_constraints = ON');
    try {
      await expect(
        run(
          "INSERT INTO teams(id,slug,name,membership_mode,created_at) VALUES('explicit','explicit','Explicit','explicit',0)"
        )
      ).rejects.toThrow('CloudForge legacy team conflict');
      await team();
      const before = (await state())!;
      await expect(team('second', 'second')).rejects.toThrow(
        'CloudForge legacy team conflict'
      );
      await expect(
        run(
          "UPDATE teams SET membership_mode='explicit' WHERE id='legacy-team'"
        )
      ).rejects.toThrow('CloudForge legacy team conflict');
      expect(await state()).toEqual(before);
      expect(await all('SELECT id FROM teams')).toEqual([
        { id: 'legacy-team' },
      ]);
    } finally {
      await run('PRAGMA ignore_check_constraints = OFF');
    }
  });

  it('团队id及revision不可回退、跳号或写入非整数', async () => {
    await team();
    const before = (await state())!;
    for (const sql of [
      "UPDATE teams SET id='other' WHERE id='legacy-team'",
      "UPDATE teams SET revision=-1 WHERE id='legacy-team'",
      "UPDATE teams SET revision=revision+2 WHERE id='legacy-team'",
      "UPDATE teams SET revision=0.5 WHERE id='legacy-team'",
    ])
      await expect(run(sql)).rejects.toThrow('CloudForge legacy team conflict');
    expect(await state()).toEqual(before);
  });

  it('state不可删除、REPLACE、重置、跳号、改变id或重绑仍存活的团队', async () => {
    await team();
    const before = (await state())!;
    const recursive = await env.DB.prepare(
      'PRAGMA recursive_triggers'
    ).first<number>('recursive_triggers');
    await run('PRAGMA recursive_triggers = OFF');
    await run('PRAGMA ignore_check_constraints = ON');
    try {
      for (const sql of [
        'DELETE FROM access_control_state',
        'INSERT OR REPLACE INTO access_control_state(id,generation) VALUES(1,0)',
        'INSERT INTO access_control_state(id,generation) VALUES(2,0)',
        'UPDATE access_control_state SET generation=generation',
        'UPDATE access_control_state SET generation=generation-1',
        'UPDATE access_control_state SET generation=generation+2',
        'UPDATE access_control_state SET generation=0.5',
        'UPDATE access_control_state SET generation=generation+1,id=2',
        "UPDATE access_control_state SET generation=generation+1,legacy_shared_team_id='other'",
        'UPDATE access_control_state SET generation=generation+1,legacy_shared_team_id=NULL',
      ])
        await expect(run(sql)).rejects.toThrow();
      expect(await state()).toEqual(before);
      await run('UPDATE access_control_state SET generation=generation+1');
      expect(await state()).toEqual({
        ...before,
        generation: before.generation + 1,
      });
    } finally {
      await run('PRAGMA ignore_check_constraints = OFF');
      await run(`PRAGMA recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
    }
  });

  it('旧协作者默认write/revision0，重复旧式DO NOTHING不扩大权限或代数', async () => {
    await collaboratorsWorld();
    await collaboration();
    const before = (await state())!;
    await run(
      "INSERT INTO repository_collaborators(repository_id,user_id,created_at) VALUES('repo','member',1) ON CONFLICT DO NOTHING"
    );
    expect(
      await all(
        'SELECT repository_id,user_id,role,revision,created_at FROM repository_collaborators'
      )
    ).toEqual([
      {
        repository_id: 'repo',
        user_id: 'member',
        role: 'write',
        revision: 0,
        created_at: 0,
      },
    ]);
    expect(await state()).toEqual(before);
  });

  it('已提升revision的grant被重复PUT或REPLACE时保持原值，批量中的其他新row继续插入', async () => {
    const t = makeEnv();
    const admin = await bootstrapAdmin(t);
    await addMember(t, admin, 'member');
    expect(
      (await call(t, '/api/repos', { cookie: admin, json: { name: 'app' } }))
        .status
    ).toBe(201);
    const path = '/api/repos/octocat/app/collaborators/member';
    expect((await call(t, path, { cookie: admin, method: 'PUT' })).status).toBe(
      200
    );
    const original = (
      await all<{
        repository_id: string;
        user_id: string;
        role: string;
        revision: number;
        created_at: number;
      }>('SELECT * FROM repository_collaborators')
    )[0];
    await run('UPDATE repository_collaborators SET revision = revision + 1');
    const retained = { ...original, revision: 1 };
    const before = (await state())!;
    const audits = await all(
      "SELECT id FROM audit_events WHERE action = 'collaborator.added'"
    );
    expect((await call(t, path, { cookie: admin, method: 'PUT' })).status).toBe(
      200
    );
    expect(await all('SELECT * FROM repository_collaborators')).toEqual([
      retained,
    ]);
    expect(
      await all(
        "SELECT id FROM audit_events WHERE action = 'collaborator.added'"
      )
    ).toEqual(audits);
    const replaced = await all(
      'INSERT OR REPLACE INTO repository_collaborators(repository_id,user_id,created_at) VALUES(?,?,99) RETURNING user_id',
      original.repository_id,
      original.user_id
    );
    expect(replaced).toEqual([]);
    expect(await all('SELECT * FROM repository_collaborators')).toEqual([
      retained,
    ]);
    expect(await state()).toEqual(before);
    await user('first-new');
    await user('last-new');
    const bulkBefore = (await state())!;
    const inserted = await all<{ user_id: string }>(
      'INSERT OR REPLACE INTO repository_collaborators(repository_id,user_id,created_at) VALUES(?,?,1),(?,?,99),(?,?,2) RETURNING user_id',
      original.repository_id,
      'first-new',
      original.repository_id,
      original.user_id,
      original.repository_id,
      'last-new'
    );
    expect(inserted).toEqual([
      { user_id: 'first-new' },
      { user_id: 'last-new' },
    ]);
    expect((await state())!.generation).toBe(bulkBefore.generation + 2);
    expect(
      await all(
        'SELECT * FROM repository_collaborators WHERE user_id=?',
        original.user_id
      )
    ).toEqual([retained]);
  });

  it.each(['read', 'triage', 'maintain', 'admin'])(
    '未发布角色%s即使关闭CHECK也不能插入或替换旧write',
    async (role) => {
      await collaboratorsWorld();
      await run('PRAGMA ignore_check_constraints = ON');
      try {
        await expect(
          run(
            "INSERT INTO repository_collaborators(repository_id,user_id,role,created_at) VALUES('repo','member',?,0)",
            role
          )
        ).rejects.toThrow('CloudForge compatibility role conflict');
        await collaboration();
        const before = (await state())!;
        await expect(
          run(
            "UPDATE repository_collaborators SET role=? WHERE repository_id='repo'",
            role
          )
        ).rejects.toThrow('CloudForge compatibility role conflict');
        await expect(
          run(
            "INSERT OR REPLACE INTO repository_collaborators(repository_id,user_id,role,created_at) VALUES('repo','member',?,0)",
            role
          )
        ).rejects.toThrow('CloudForge compatibility role conflict');
        expect(
          await all('SELECT role,revision FROM repository_collaborators')
        ).toEqual([{ role: 'write', revision: 0 }]);
        expect(await state()).toEqual(before);
      } finally {
        await run('PRAGMA ignore_check_constraints = OFF');
      }
    }
  );

  it('协作者关键字和revision拒绝非法变动，合法撤销推进generation', async () => {
    await collaboratorsWorld();
    await collaboration();
    const before = (await state())!;
    for (const sql of [
      "UPDATE repository_collaborators SET user_id='owner'",
      "UPDATE repository_collaborators SET repository_id='other'",
      'UPDATE repository_collaborators SET revision=-1',
      'UPDATE repository_collaborators SET revision=revision+2',
      'UPDATE repository_collaborators SET revision=0.5',
    ])
      await expect(run(sql)).rejects.toThrow(
        'CloudForge compatibility role conflict'
      );
    expect(await state()).toEqual(before);
    await run('UPDATE repository_collaborators SET revision=revision+1');
    expect((await state())!.generation).toBe(before.generation + 1);
    await run('DELETE FROM repository_collaborators');
    expect((await state())!.generation).toBe(before.generation + 2);
  });

  it('封禁、站点角色与仓库可见性推进generation，普通描述缓存不制造ACL变化', async () => {
    await user('owner');
    await repo();
    const before = (await state())!;
    await run("UPDATE users SET role='admin' WHERE id='owner'");
    await run("UPDATE users SET banned=1 WHERE id='owner'");
    await run("UPDATE repositories SET visibility='public' WHERE id='repo'");
    expect((await state())!.generation).toBe(before.generation + 3);
    await run("UPDATE users SET role='admin',banned=1 WHERE id='owner'");
    await run(
      "UPDATE repositories SET description='new description',language='TypeScript',language_sha='sha' WHERE id='repo'"
    );
    expect((await state())!.generation).toBe(before.generation + 3);
  });

  it('团队仓库保持internal/public，公开集合不会因schema而缩窄', async () => {
    await user('owner');
    await team();
    await expect(
      repo('invalid', 'owner', 'legacy-team', 'private')
    ).rejects.toThrow('CloudForge repository access conflict');
    await repo('team-repo', 'owner', 'legacy-team', 'internal');
    await run(
      "UPDATE repositories SET visibility='public' WHERE id='team-repo'"
    );
    const before = (await state())!;
    await expect(
      run("UPDATE repositories SET visibility='private' WHERE id='team-repo'")
    ).rejects.toThrow('CloudForge repository access conflict');
    expect(await all('SELECT id,visibility FROM repositories')).toEqual([
      { id: 'team-repo', visibility: 'public' },
    ]);
    expect(await state()).toEqual(before);
  });

  it('真实D1单个JSON参数种129用户，逐行claims/generation完整且无需扩展绑定', async () => {
    const before = (await state())!;
    const ids = Array.from(
      { length: 129 },
      (_, i) => `bulk-${i.toString().padStart(3, '0')}`
    );
    await run(
      `INSERT INTO users(id,name,email,username) SELECT value,value,value||'@example.com',value FROM json_each(?)`,
      JSON.stringify(ids)
    );
    expect(
      await all('SELECT slug FROM namespace_claims ORDER BY slug')
    ).toEqual(ids.map((slug) => ({ slug })));
    expect((await state())!.generation).toBe(before.generation + 129);
  });
});
