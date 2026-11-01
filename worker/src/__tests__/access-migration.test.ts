// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { readAccessRuntime } from '../lib/access-runtime';

// This binding is intentionally separate from env.DB. Its only test upgrades a populated pre-ACL
// database without resetting production guards or leaving an exhausted generation in shared storage.
const db = env.ACCESS_MIGRATION_DB;
const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const canonicalRow = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
  );

async function snapshot() {
  const objects = (
    await db
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY type, name`
      )
      .all<{
        type: string;
        name: string;
        tbl_name: string;
        sql: string | null;
      }>()
  ).results;
  const tables = objects
    .filter((object) => object.type === 'table')
    .map((object) => object.name);
  const data = await db.batch<Record<string, unknown>>(
    tables.map((name) => db.prepare(`SELECT * FROM ${quoteIdentifier(name)}`))
  );
  return {
    objects,
    data: Object.fromEntries(
      tables.map((name, index) => [
        name,
        data[index].results.map(canonicalRow).sort(),
      ])
    ),
  };
}

async function legacyContents() {
  const selects = [
    'SELECT id, username, role, banned, auth_version FROM users ORDER BY id',
    'SELECT id, owner_id, team_id, visibility, name, artifacts_name FROM repositories ORDER BY id',
    'SELECT repository_id, user_id, created_at FROM repository_collaborators ORDER BY repository_id, user_id',
    'SELECT * FROM agents ORDER BY user_id',
    'SELECT * FROM issues ORDER BY id',
    'SELECT * FROM workflow_runs ORDER BY id',
    'SELECT * FROM sessions ORDER BY id',
    'SELECT * FROM oauth_clients ORDER BY id',
    'SELECT * FROM oauth_resources ORDER BY id',
    'SELECT * FROM oauth_client_resources ORDER BY id',
    'SELECT * FROM oauth_refresh_tokens ORDER BY id',
    'SELECT * FROM oauth_access_tokens ORDER BY id',
    'SELECT * FROM oauth_consents ORDER BY id',
  ];
  return (await db.batch(selects.map((sql) => db.prepare(sql)))).map(
    (result) => result.results
  );
}

async function seedLegacy() {
  await db.batch([
    db.prepare(`INSERT INTO users (id,name,email,username,role,banned,auth_version) VALUES
      ('owner','Owner','owner@migration.invalid','owner','admin',0,7),
      ('member','Member','member@migration.invalid','member','user',0,3),
      ('reviewer','Reviewer','reviewer@migration.invalid','reviewer','user',0,2),
      ('pending','Pending','pending@migration.invalid',NULL,'user',0,0)`),
    db.prepare(
      "INSERT INTO teams(id,slug,name,created_at) VALUES('legacy-team','legacy-shared','Shared',10)"
    ),
    db.prepare(`INSERT INTO repositories(id,owner_id,team_id,visibility,name,artifacts_name,created_at,updated_at) VALUES
      ('personal-repo','owner',NULL,'private','personal','r_personal',10,11),
      ('team-repo','owner','legacy-team','public','team','r_team',10,11),
      ('agent-repo','reviewer',NULL,'internal','agent','r_agent',10,11)`),
    db.prepare(`INSERT INTO repository_collaborators(repository_id,user_id,created_at) VALUES
      ('team-repo','member',17),('agent-repo','owner',18)`),
    db.prepare(`INSERT INTO agents(user_id,repository_id,name,trigger_ask,trigger_above,created_by_id,created_at)
      VALUES('reviewer','agent-repo','Reviewer','Review?',0.5,'owner',10)`),
    db.prepare(`INSERT INTO issues(id,repository_id,number,title,body,author_id,created_at,updated_at)
      VALUES('retained-issue','team-repo',1,'Retain this issue','Body','member',10,11)`),
    db.prepare(`INSERT INTO workflow_runs(id,repository_id,run_number,workflow_path,name,event,ref,head_sha,display_title,actor_id,status,conclusion,created_at)
      VALUES('retained-run','team-repo',1,'.github/workflows/test.yml','Tests','push','refs/heads/main','1111111111111111111111111111111111111111','Commit','owner','completed','success',10)`),
    // These historical nullable values are valid in <=0062. The CLI upgrade must not rebuild
    // OAuth parent tables, cascade tokens, or turn this additive index into a NOT NULL migration.
    db.prepare(`INSERT INTO sessions(id,token,user_id,expires_at,created_at,updated_at,auth_version)
      VALUES('retained-session','fixture-session-token','owner',4102444800000,10,10,7)`),
    db.prepare(`INSERT INTO oauth_clients(id,client_id,user_id,name,redirect_uris,client_credentials_scopes)
      VALUES('retained-client-row','retained-client','owner','Migration client','["https://client.migration.invalid/callback"]',NULL)`),
    db.prepare(`INSERT INTO oauth_resources(id,identifier,name)
      VALUES('retained-resource','https://resource.migration.invalid/mcp','Migration resource')`),
    db.prepare(`INSERT INTO oauth_client_resources(id,client_id,resource_id,metadata,created_at) VALUES
      ('retained-link','retained-client','https://resource.migration.invalid/mcp','{"retained":true}',NULL),
      ('duplicate-link','retained-client','https://resource.migration.invalid/mcp','{"duplicate":true}',NULL)`),
    db.prepare(`INSERT INTO oauth_refresh_tokens(id,token,client_id,session_id,user_id,resources,scopes,created_at,expires_at)
      VALUES('retained-refresh','fixture-refresh-token','retained-client','retained-session','owner','["https://resource.migration.invalid/mcp"]','["openid"]',NULL,NULL)`),
    db.prepare(`INSERT INTO oauth_access_tokens(id,token,client_id,session_id,user_id,refresh_id,resources,scopes,created_at,expires_at) VALUES
      ('retained-access','fixture-access-token','retained-client','retained-session','owner','retained-refresh','["https://resource.migration.invalid/mcp"]','["openid"]',NULL,NULL),
      ('retained-null-access',NULL,'retained-client','retained-session','owner','retained-refresh','["https://resource.migration.invalid/mcp"]','["openid"]',NULL,NULL)`),
    db.prepare(`INSERT INTO oauth_consents(id,client_id,user_id,resources,scopes,created_at,updated_at)
      VALUES('retained-consent','retained-client','owner','["https://resource.migration.invalid/mcp"]','["openid"]',NULL,NULL)`),
  ]);
}

describe('权限兼容迁移：旧库升级与原子失败', () => {
  it('坏数据逐文件回滚DDL、触发器和收据；修正后保留权限及OAuth旧数据升级并可重试', async () => {
    const migration = env.TEST_D1_MIGRATIONS.find((item) =>
      /^0063_/.test(item.name)
    );
    expect(
      migration,
      'The real generated compatibility migration is required'
    ).toBeDefined();
    const oauthMigration = env.TEST_D1_MIGRATIONS.find((item) =>
      /^0064_/.test(item.name)
    );
    expect(
      oauthMigration,
      'The real generated OAuth resource uniqueness migration is required'
    ).toBeDefined();
    const additions = [migration!];
    // ALTER-only changes to legacy parent/child tables avoid D1 DROP/CASCADE hazards.
    expect(migration!.queries.join('\n')).not.toMatch(
      /DROP\s+TABLE\s+[`"]?(?:users|teams|repositories|repository_collaborators)\b/i
    );
    expect(oauthMigration!.queries.join('\n')).toMatch(
      /CREATE UNIQUE INDEX [`"]?oauthClientResources_clientId_resourceId_uidx[`"]? ON [`"]?oauth_client_resources/i
    );
    expect(oauthMigration!.queries.join('\n')).not.toMatch(
      /(?:DROP|ALTER|CREATE)\s+TABLE\b/i
    );
    await applyD1Migrations(db, env.TEST_LEGACY_D1_MIGRATIONS);
    await seedLegacy();
    const oldTriggers = (
      await db
        .prepare(
          "SELECT name, sql FROM sqlite_schema WHERE type='trigger' ORDER BY name"
        )
        .all<{ name: string; sql: string }>()
    ).results;
    const failedUpgrade = async (message: string) => {
      const before = await snapshot();
      await expect(applyD1Migrations(db, additions)).rejects.toThrow(message);
      expect(await snapshot()).toEqual(before);
      expect(
        await db
          .prepare('SELECT COUNT(*) AS n FROM d1_migrations WHERE name=?')
          .bind(migration!.name)
          .first<number>('n')
      ).toBe(0);
    };

    // Multiple old teams must not let LIMIT 1 select an arbitrary compatibility namespace.
    await db
      .prepare(
        "INSERT INTO teams(id,slug,name,created_at) VALUES('second-team','second-shared','Second',10)"
      )
      .run();
    await failedUpgrade('CloudForge legacy team conflict');
    await db.prepare("DELETE FROM teams WHERE id='second-team'").run();

    // The old tables allow cross-type and case-only collisions; the backfill must not choose a winner.
    await db
      .prepare("UPDATE teams SET slug='owner' WHERE id='legacy-team'")
      .run();
    await failedUpgrade('CloudForge namespace conflict');
    await db
      .prepare("UPDATE teams SET slug='legacy-shared' WHERE id='legacy-team'")
      .run();
    await db
      .prepare(
        "INSERT INTO users(id,name,email,username,role) VALUES('case-duplicate','Duplicate','duplicate@migration.invalid','OWNER','user')"
      )
      .run();
    await failedUpgrade('CloudForge namespace conflict');
    await db.prepare("DELETE FROM users WHERE id='case-duplicate'").run();

    // Legacy team-private rows are still instance-readable; never silently reclassify them.
    await db
      .prepare(
        "UPDATE repositories SET visibility='private' WHERE id='team-repo'"
      )
      .run();
    await failedUpgrade('CloudForge access bootstrap invalid');
    await db
      .prepare(
        "UPDATE repositories SET visibility='public' WHERE id='team-repo'"
      )
      .run();

    const retained = await legacyContents();
    await applyD1Migrations(db, additions);
    expect(await legacyContents()).toEqual(retained);
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results
    ).toEqual([]);
    const restoredTriggers = new Map(
      (
        await db
          .prepare(
            "SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name"
          )
          .all<{ name: string; sql: string }>()
      ).results.map((row) => [row.name, row.sql])
    );
    for (const trigger of oldTriggers)
      expect(restoredTriggers.get(trigger.name)).toBe(trigger.sql);
    expect(
      (
        await db
          .prepare(
            'SELECT role,revision FROM repository_collaborators ORDER BY repository_id,user_id'
          )
          .all()
      ).results
    ).toEqual([
      { role: 'write', revision: 0 },
      { role: 'write', revision: 0 },
    ]);
    expect(
      await db.prepare('SELECT id,membership_mode,revision FROM teams').first()
    ).toEqual({ id: 'legacy-team', membership_mode: 'instance', revision: 0 });
    expect(
      await db
        .prepare('SELECT id,legacy_shared_team_id FROM access_control_state')
        .first()
    ).toEqual({ id: 1, legacy_shared_team_id: 'legacy-team' });

    expect(
      (
        await db
          .prepare(
            'SELECT slug,kind,subject_id FROM namespace_claims ORDER BY slug'
          )
          .all()
      ).results
    ).toEqual([
      { slug: 'legacy-shared', kind: 'team', subject_id: 'legacy-team' },
      { slug: 'member', kind: 'user', subject_id: 'member' },
      { slug: 'owner', kind: 'user', subject_id: 'owner' },
      { slug: 'reviewer', kind: 'user', subject_id: 'reviewer' },
    ]);

    // Migrations are atomic per file. 0063 has committed successfully; the following 0064
    // failure must restore its own trigger/index changes, not undo the earlier ACL migration.
    const beforeOAuthUpgrade = await snapshot();
    await expect(
      applyD1Migrations(db, [migration!, oauthMigration!])
    ).rejects.toThrow('UNIQUE constraint failed');
    expect(await snapshot()).toEqual(beforeOAuthUpgrade);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM d1_migrations WHERE name=?')
        .bind(migration!.name)
        .first<number>('n')
    ).toBe(1);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM d1_migrations WHERE name=?')
        .bind(oauthMigration!.name)
        .first<number>('n')
    ).toBe(0);

    // This explicit fixture repair models a reviewed operator action. The migration itself
    // must refuse duplicates and must never silently discard an OAuth registration.
    await db
      .prepare("DELETE FROM oauth_client_resources WHERE id='duplicate-link'")
      .run();
    const repaired = await legacyContents();
    await applyD1Migrations(db, [oauthMigration!]);
    expect(await legacyContents()).toEqual(repaired);
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results
    ).toEqual([]);
    const upgradedTriggers = (
      await db
        .prepare(
          "SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name"
        )
        .all<{ name: string; sql: string }>()
    ).results;
    expect(new Map(upgradedTriggers.map((row) => [row.name, row.sql]))).toEqual(
      restoredTriggers
    );
    for (const [table, columns] of [
      ['oauth_refresh_tokens', ['created_at', 'expires_at']],
      ['oauth_access_tokens', ['token', 'created_at', 'expires_at']],
      ['oauth_consents', ['created_at', 'updated_at']],
    ] as const) {
      const info = (
        await db
          .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
          .all<{ name: string; notnull: number }>()
      ).results;
      for (const column of columns)
        expect(info.find((row) => row.name === column)?.notnull).toBe(0);
    }
    expect(
      (
        await db
          .prepare('PRAGMA table_info(oauth_clients)')
          .all<{ name: string; dflt_value: string | null }>()
      ).results.find((row) => row.name === 'client_credentials_scopes')
        ?.dflt_value
    ).toBeNull();

    const upgraded = await snapshot();
    await expect(
      db
        .prepare(
          `INSERT INTO oauth_client_resources(id,client_id,resource_id)
          VALUES('another-link','retained-client','https://resource.migration.invalid/mcp')`
        )
        .run()
    ).rejects.toThrow('UNIQUE constraint failed');
    expect(await snapshot()).toEqual(upgraded);
    await applyD1Migrations(db, [migration!, oauthMigration!]);
    expect(await snapshot()).toEqual(upgraded);
    const state = await db
      .prepare('SELECT generation FROM access_control_state WHERE id=1')
      .first<{ generation: number }>();
    expect(state).not.toBeNull();
    // Later migrations may add state. They must preserve the populated legacy fixture,
    // retain the existing access generation, and remain idempotent themselves.
    await applyD1Migrations(db, env.TEST_D1_MIGRATIONS);
    expect(await legacyContents()).toEqual(repaired);
    expect(
      await db
        .prepare('SELECT generation FROM access_control_state WHERE id=1')
        .first()
    ).toEqual(state);
    expect(await readAccessRuntime(db)).toMatchObject({
      ready: true,
      minimumProtocol: 1,
      rolePublishingEnabled: false,
      revision: 0,
    });
    const current = await snapshot();
    await applyD1Migrations(db, env.TEST_D1_MIGRATIONS);
    expect(await snapshot()).toEqual(current);
    // The original lifecycle guard must work after the generator drops/recreates managed triggers.
    await expect(
      db.prepare("DELETE FROM users WHERE id='owner'").run()
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(current);
  }, 60_000);
});
