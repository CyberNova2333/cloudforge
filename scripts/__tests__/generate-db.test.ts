// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error: plain JavaScript module, no types
import { generateDatabase } from '../generate-db.mjs';
import {
  RECOVERY_TRIGGER_NAME,
  RECOVERY_TRIGGER_SQL,
} from '../../worker/src/db/recovery-trigger';

let root: string;
let directory: string;
const original = 'CREATE TABLE old_table (id text PRIMARY KEY);\n';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cloudforge-generate-db-'));
  directory = join(root, 'migrations');
  mkdirSync(join(directory, 'meta'), { recursive: true });
  writeFileSync(join(directory, '0000_old.sql'), original);
  writeFileSync(
    join(directory, 'meta', '_journal.json'),
    JSON.stringify({ entries: [{ tag: '0000_old' }] })
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
const read = (name: string) => readFileSync(join(directory, name), 'utf8');
function createMigration(name = '0001_new') {
  writeFileSync(
    join(directory, name + '.sql'),
    'CREATE TABLE new_table (id text);\r\n'
  );
  const journal = JSON.parse(read('meta/_journal.json'));
  journal.entries.push({ tag: name });
  writeFileSync(
    join(directory, 'meta', '_journal.json'),
    JSON.stringify(journal)
  );
}
const initial = () => generateDatabase({ root, run: () => createMigration() });

describe('数据库迁移与声明式触发器生成', () => {
  it('只给本次新迁移附加触发器，不修改历史，并用 Drizzle 忽略的元数据名', () => {
    expect(initial()).toBe('0001_new.sql');
    expect(read('0000_old.sql')).toBe(original);
    const generated = read('0001_new.sql');
    expect(generated).toContain('CREATE TABLE new_table');
    expect(generated).toContain(
      `DROP TRIGGER IF EXISTS \`${RECOVERY_TRIGGER_NAME}\`;`
    );
    expect(generated).toContain(RECOVERY_TRIGGER_SQL);
    expect(generated).not.toContain('\r');
    const state = JSON.parse(read('meta/_triggers.json'));
    expect(state).toMatchObject({
      version: 1,
      triggers: [
        {
          name: RECOVERY_TRIGGER_NAME,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        {
          name: 'cloudforge_password_auth_version_v1',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        {
          name: 'cloudforge_factor_auth_version_v1',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        ...[
          'cloudforge_oauth_consent_revoked_v1',
          'cloudforge_oauth_consent_insert_v1',
          'cloudforge_oauth_consent_update_v1',
          'cloudforge_oauth_refresh_insert_v1',
          'cloudforge_oauth_access_insert_v1',
          'cloudforge_auth_policy_insert_v1',
          'cloudforge_auth_policy_update_v1',
          'cloudforge_oidc_configuration_retire_v1',
          'cloudforge_oidc_binding_owner_v1',
          'cloudforge_oidc_binding_revoked_v1',
          'cloudforge_oidc_registry_immutable_v1',
          'cloudforge_oidc_configuration_publish_v1',
          'cloudforge_oidc_binding_confirm_v1',
          'cloudforge_oidc_session_source_immutable_v1',
          'cloudforge_oidc_login_cancel_v1',
          'cloudforge_oidc_login_complete_v1',
        ].map((name) => ({
          name,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        })),
      ],
    });
    expect(
      readdirSync(join(directory, 'meta')).every((name) => name.startsWith('_'))
    ).toBe(true);
  });

  it('重复生成无变化时不创建自定义迁移、不改任何旧迁移或元数据', () => {
    initial();
    const migration = read('0001_new.sql');
    const metadata = read('meta/_triggers.json');
    const calls: string[][] = [];
    expect(
      generateDatabase({ root, run: (args: string[]) => calls.push(args) })
    ).toBeNull();
    expect(calls).toEqual([[]]);
    expect(read('0001_new.sql')).toBe(migration);
    expect(read('meta/_triggers.json')).toBe(metadata);
  });

  it('仅触发器变更时先让 Drizzle 生成自定义迁移，随后附加声明 SQL', () => {
    initial();
    const old = read('0001_new.sql');
    const calls: string[][] = [];
    const sql =
      'CREATE TRIGGER cloudforge_mfa_recovery_v1 AFTER INSERT ON changed BEGIN SELECT 1; END';
    expect(
      generateDatabase({
        root,
        triggers: [{ name: RECOVERY_TRIGGER_NAME, sql }],
        run: (args: string[]) => {
          calls.push(args);
          if (args.includes('--custom')) createMigration('0002_custom');
        },
      })
    ).toBe('0002_custom.sql');
    expect(calls).toEqual([[], ['--custom', '--name', 'auth_triggers']]);
    expect(read('0001_new.sql')).toBe(old);
    expect(read('0002_custom.sql')).toContain(sql + ';');
  });

  it('表结构迁移重新附加未变化的触发器，防止 SQLite 重建表时丢失它', () => {
    initial();
    const metadata = read('meta/_triggers.json');
    expect(
      generateDatabase({ root, run: () => createMigration('0002_rebuilt') })
    ).toBe('0002_rebuilt.sql');
    expect(read('0002_rebuilt.sql')).toContain(RECOVERY_TRIGGER_SQL);
    expect(read('meta/_triggers.json')).toBe(metadata);
  });

  it.each(['users', 'two_factors', 'sessions'])(
    '在重建 %s 前移除跨表触发器，迁移结束后恢复可工作的触发器',
    (table) => {
      initial();
      const db = new DatabaseSync(':memory:');
      try {
        const migrations = new URL('../../migrations/', import.meta.url);
        for (const name of readdirSync(migrations)
          .filter((name) => name.endsWith('.sql'))
          .sort())
          db.exec(readFileSync(new URL(name, migrations), 'utf8'));
        const definition = db
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
          )
          .get(table)?.sql as string;
        const temporary = `__new_${table}`;
        const replacement = definition.replace(
          /^CREATE TABLE\s+(?:`[^`]+`|"[^"]+"|\w+)/i,
          `CREATE TABLE "${temporary}"`
        );
        // Drizzle rebuilds referenced tables using this sequence. A trigger on a different
        // table survives DROP, then makes ALTER fail while its referenced table is absent.
        const rebuild = `PRAGMA foreign_keys=OFF;
${replacement};
INSERT INTO "${temporary}" SELECT * FROM "${table}";
DROP TABLE "${table}";
ALTER TABLE "${temporary}" RENAME TO "${table}";
PRAGMA foreign_keys=ON;`;
        generateDatabase({
          root,
          run: () => {
            createMigration('0002_rebuilt');
            writeFileSync(join(directory, '0002_rebuilt.sql'), rebuild);
          },
        });
        db.exec(read('0002_rebuilt.sql'));
        expect(
          db
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?"
            )
            .get(RECOVERY_TRIGGER_NAME)?.sql
        ).toBe(RECOVERY_TRIGGER_SQL);
        db.exec(`
          INSERT INTO users (id, name, email, username, two_factor_enabled)
            VALUES ('rebuild-person', 'Person', 'person@example.com', 'person', 1);
          INSERT INTO two_factors (id, user_id, secret, backup_codes, verified)
            VALUES ('rebuild-factor', 'rebuild-person', 'encrypted', 'encrypted-codes', 1);
          INSERT INTO mfa_recovery_events (id, user_id, reason, created_at)
            VALUES ('after-rebuild', 'rebuild-person', 'Lost authenticator', 1);
        `);
        expect(db.prepare('SELECT id FROM two_factors').all()).toEqual([]);
        expect(
          db
            .prepare(
              "SELECT two_factor_enabled FROM users WHERE id = 'rebuild-person'"
            )
            .get()?.two_factor_enabled
        ).toBe(0);
        expect(
          db
            .prepare(
              "SELECT action FROM audit_events WHERE id = 'after-rebuild'"
            )
            .get()?.action
        ).toBe('user.mfa_reset');
      } finally {
        db.close();
      }
    }
  );

  it('删除声明时新建移除触发器的迁移，保留之前的历史', () => {
    initial();
    const old = read('0001_new.sql');
    generateDatabase({
      root,
      triggers: [],
      run: (args: string[]) => {
        if (args.includes('--custom')) createMigration('0002_removed');
      },
    });
    expect(read('0002_removed.sql')).toContain(
      `DROP TRIGGER IF EXISTS \`${RECOVERY_TRIGGER_NAME}\`;`
    );
    expect(read('0002_removed.sql')).not.toContain('CREATE TRIGGER');
    expect(read('0001_new.sql')).toBe(old);
  });

  it('Drizzle 未创建新迁移时拒绝把新触发器写入最后一个旧迁移', () => {
    const calls: string[][] = [];
    expect(() =>
      generateDatabase({ root, run: (args: string[]) => calls.push(args) })
    ).toThrow('did not create a migration');
    expect(calls).toEqual([[], ['--custom', '--name', 'auth_triggers']]);
    expect(read('0000_old.sql')).toBe(original);
    expect(readdirSync(join(directory, 'meta'))).toEqual(['_journal.json']);
  });

  it('日志记录不匹配时失败，不向未登记文件附加 SQL 或写元数据', () => {
    expect(() =>
      generateDatabase({
        root,
        run: () => {
          writeFileSync(join(directory, '0001_unregistered.sql'), 'SELECT 1;');
        },
      })
    ).toThrow('does not match the Drizzle journal');
    expect(read('0001_unregistered.sql')).toBe('SELECT 1;');
    expect(read('0000_old.sql')).toBe(original);
    expect(readdirSync(join(directory, 'meta'))).toEqual(['_journal.json']);
  });

  it('原生成器异常不被吞掉，也不写入成功元数据', () => {
    expect(() =>
      generateDatabase({
        root,
        run: () => {
          throw new Error('schema generation failed');
        },
      })
    ).toThrow('schema generation failed');
    expect(read('0000_old.sql')).toBe(original);
    expect(readdirSync(join(directory, 'meta'))).toEqual(['_journal.json']);
  });

  it('拒绝无效或重复声明，避免拼接不受控触发器名', () => {
    let ran = false;
    expect(() =>
      generateDatabase({
        root,
        triggers: [{ name: 'x`; DELETE FROM users;', sql: 'SELECT 1' }],
        run: () => {
          ran = true;
        },
      })
    ).toThrow('Invalid trigger declaration');
    expect(ran).toBe(false);
    expect(() =>
      generateDatabase({
        root,
        triggers: [
          { name: 'x', sql: 'SELECT 1' },
          { name: 'x', sql: 'SELECT 2' },
        ],
        run: () => {},
      })
    ).toThrow('Duplicate trigger declaration');
  });
});
