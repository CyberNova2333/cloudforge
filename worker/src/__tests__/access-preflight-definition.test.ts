// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_PREFLIGHT_COMPAT_DEFINITION,
  ACCESS_PREFLIGHT_LEGACY_DEFINITION,
  accessDefinitionGuardSql,
} from '../../../scripts/cloudforge/access-preflight-definition';
import {
  accessPreflightDiscoveryQuery,
  accessPreflightQuery,
} from '../../../scripts/cloudforge/access-preflight-data';

// Only this empty, test-only database is rebuilt. The application and legacy migration
// fixtures retain their production guards throughout every test.
const db = env.ACCESS_DEFINITION_DB;
type Version = 'legacy' | 'compat-v1';
const definition = (version: Version) =>
  version === 'legacy'
    ? ACCESS_PREFLIGHT_LEGACY_DEFINITION
    : ACCESS_PREFLIGHT_COMPAT_DEFINITION;
async function fixture(
  version: Version,
  mutate: (name: string, sql: string) => string = (_name, sql) => sql
) {
  const objects = (
    await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*'"
      )
      .all<{ name: string }>()
  ).results;
  const order = [
    'agents',
    'repository_collaborators',
    'repositories',
    'teams',
    'users',
  ];
  objects.sort((a, b) => {
    const rank = (name: string) =>
      order.indexOf(name) < 0 ? order.length : order.indexOf(name);
    return rank(a.name) - rank(b.name);
  });
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = on'),
    ...objects.map(({ name }) =>
      db.prepare(`DROP TABLE "${name.replaceAll('"', '""')}"`)
    ),
  ]);
  const statements = Object.entries(definition(version)).flatMap(
    ([name, table]) => [
      mutate(name, table.sql),
      ...table.indexes.flatMap(
        (index: { readonly sql: string | null; readonly name: string }) =>
          index.sql ? [mutate(index.name, index.sql)] : []
      ),
    ]
  );
  await db.batch(statements.filter(Boolean).map((sql) => db.prepare(sql)));
}
const supported = (version: Version) =>
  db
    .prepare(
      `SELECT CASE WHEN ${accessDefinitionGuardSql(version)} THEN 1 ELSE 0 END AS valid`
    )
    .first<number>('valid');

describe('权限预检的数据库定义完整性（独立真实 D1）', () => {
  it.each(['legacy', 'compat-v1'] as const)(
    '接受实际迁移形成的 %s 定义',
    async (version) => {
      await fixture(version);
      expect(await supported(version)).toBe(1);
    }
  );

  it('兼容 Windows CRLF 的源码换行，但不改写 SQL 字符串字面量', async () => {
    await fixture('compat-v1', (_name, sql) => sql.replaceAll('\n', '\r\n'));
    expect(await supported('compat-v1')).toBe(1);
    await fixture('compat-v1', (name, sql) =>
      name === 'repository_collaborators'
        ? sql.replace("DEFAULT 'write'", "DEFAULT 'wri\rte'")
        : sql
    );
    expect(await supported('compat-v1')).toBe(0);
  });

  it.each([
    [
      '缺失唯一索引',
      'namespace_claims_subject_uq',
      (sql: string) => sql.replace('CREATE UNIQUE INDEX', 'CREATE INDEX'),
    ],
    [
      '改变索引排序规则',
      'teams_slug_unique',
      (sql: string) => sql.replace('(`slug`)', '(`slug` COLLATE NOCASE)'),
    ],
    [
      '弱化部分唯一索引',
      'repositories_team_name_uq',
      (sql: string) =>
        sql.replace(
          'WHERE team_id IS NOT NULL',
          "WHERE team_id IS NOT NULL AND name != 'skip'"
        ),
    ],
    [
      '改变默认角色',
      'repository_collaborators',
      (sql: string) => sql.replace("DEFAULT 'write'", "DEFAULT 'admin'"),
    ],
    [
      '缺失团队主键',
      'teams',
      (sql: string) =>
        sql.replace('text PRIMARY KEY NOT NULL', 'text NOT NULL'),
    ],
    [
      '缺失非空限制',
      'namespace_claims',
      (sql: string) =>
        sql.replace('`subject_id` text NOT NULL', '`subject_id` text'),
    ],
    [
      '改变外键删除行为',
      'repository_collaborators',
      (sql: string) => sql.replace('ON DELETE cascade', 'ON DELETE restrict'),
    ],
    [
      '弱化代数检查',
      'access_control_state',
      (sql: string) =>
        sql.replace('<= 9007199254740991', '<= 9223372036854775807'),
    ],
    [
      '改变大小写敏感字面量',
      'namespace_claims',
      (sql: string) => sql.replace("('user', 'team')", "('USER', 'team')"),
    ],
  ] as const)('拒绝%s，即使当前数据为空', async (_case, target, mutate) => {
    await fixture('compat-v1', (name, sql) =>
      name === target ? mutate(sql) : sql
    );
    expect(await supported('compat-v1')).toBe(0);
  });

  it('拒绝未知额外索引与隐藏生成列', async () => {
    await fixture('compat-v1');
    await db
      .prepare('CREATE INDEX unexpected_access_index ON teams(name)')
      .run();
    expect(await supported('compat-v1')).toBe(0);
    await fixture('compat-v1');
    await db
      .prepare(
        'ALTER TABLE teams ADD generated_name TEXT GENERATED ALWAYS AS (name) VIRTUAL'
      )
      .run();
    expect(await supported('compat-v1')).toBe(0);
  });

  it('旧结构中残留任何大小写的权限触发器都不是受支持的旧库', async () => {
    await fixture('legacy');
    await db
      .prepare(
        'CREATE TRIGGER CLOUDFORGE_ACCESS_incomplete BEFORE INSERT ON teams BEGIN SELECT 1; END'
      )
      .run();
    expect(await supported('legacy')).toBe(0);
  });

  it('实际迁移构建的应用库也匹配兼容定义', async () => {
    const actual = await env.DB.prepare(
      `SELECT CASE WHEN ${accessDefinitionGuardSql('compat-v1')} THEN 1 ELSE 0 END AS valid`
    ).first<number>('valid');
    expect(actual).toBe(1);
  });

  it.each(['legacy', 'compat-v1'] as const)(
    '%s 拒绝权限表上不属于已知清单的自定义触发器',
    async (version) => {
      await fixture(version);
      await db
        .prepare(
          'CREATE TRIGGER custom_grant AFTER INSERT ON teams BEGIN SELECT 1; END'
        )
        .run();
      expect(await supported(version)).toBe(0);
    }
  );

  it('完整发现和快照查询保留 D1 SQL 字节数与参数上限', () => {
    const queries = [
      accessPreflightDiscoveryQuery(),
      accessPreflightQuery(
        { id: 'installation', ownershipNonce: 'nonce' },
        'legacy'
      ),
      accessPreflightQuery(
        { id: 'installation', ownershipNonce: 'nonce' },
        'compat-v1'
      ),
    ];
    for (const query of queries) {
      expect(new TextEncoder().encode(query.sql).length).toBeLessThanOrEqual(
        100_000
      );
      expect(query.params.length).toBeLessThanOrEqual(100);
    }
  });
});
