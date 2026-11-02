// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { accessDefinitionGuardSql } from './access-preflight-definition.ts';
import { ACCESS_TRIGGERS } from '../../../worker/src/db/access-triggers.ts';
import { ACCESS_RUNTIME_TRIGGERS } from '../../../worker/src/db/access-runtime-triggers.ts';
import { isValidUsername } from '../../../worker/src/members/usernames.ts';

export const ACCESS_PREFLIGHT_LIMIT = 1000;
export const ACCESS_PREFLIGHT_MAX_BYTES = 1_800_000;
const SAMPLE_LIMIT = 20;

/** Known historical columns; expanded ACL data is never interpreted as implicit legacy grants. */
export const ACCESS_PREFLIGHT_LEGACY_COLUMNS = {
  users:
    'id:text name:text email:text email_verified:integer image:text created_at:integer updated_at:integer role:text banned:integer ban_reason:text ban_expires:integer username:text display_username:text two_factor_enabled:integer auth_version:integer'
      .split(' ')
      .map((column) => `${column}:0`)
      .sort(),
  teams: 'id:text slug:text name:text created_at:integer'
    .split(' ')
    .map((column) => `${column}:0`)
    .sort(),
  repositories:
    'id:text owner_id:text team_id:text visibility:text name:text description:text default_branch:text protected_branches:text artifacts_name:text next_pr_number:integer merging_paused_at:integer merging_paused_by_id:text delete_merged_branches:integer has_issues:integer language:text language_sha:text created_at:integer updated_at:integer'
      .split(' ')
      .map((column) => `${column}:0`)
      .sort(),
  repository_collaborators: 'repository_id:text user_id:text created_at:integer'
    .split(' ')
    .map((column) => `${column}:0`)
    .sort(),
  agents:
    'user_id:text repository_id:text name:text bio:text trigger_ask:text trigger_above:real engine:text color:text facet:text guarded:integer config_sha:text config_error:text created_by_id:text created_at:integer deleted_at:integer review_language:text'
      .split(' ')
      .map((column) => `${column}:0`)
      .sort(),
  install_state:
    'installation_id:text ownership_nonce:text version:text manifest_json:text updated_at:integer'
      .split(' ')
      .map((column) => `${column}:0`)
      .sort(),
} as const;

export type AccessSchemaVersion = 'legacy' | 'compat-v1' | 'runtime-bridge-v1';
export type AccessInstallation = {
  id: string;
  ownershipNonce: string;
  allowMissing?: boolean;
};
export const ACCESS_PREFLIGHT_COMPAT_COLUMNS = {
  ...ACCESS_PREFLIGHT_LEGACY_COLUMNS,
  teams: [
    ...ACCESS_PREFLIGHT_LEGACY_COLUMNS.teams,
    'membership_mode:text:0',
    'revision:integer:0',
  ].sort(),
  repository_collaborators: [
    ...ACCESS_PREFLIGHT_LEGACY_COLUMNS.repository_collaborators,
    'role:text:0',
    'revision:integer:0',
  ].sort(),
  access_control_state: [
    'generation:integer:0',
    'id:integer:0',
    'legacy_shared_team_id:text:0',
  ],
  namespace_claims: ['kind:text:0', 'slug:text:0', 'subject_id:text:0'],
};
export const ACCESS_PREFLIGHT_BRIDGE_COLUMNS = {
  ...ACCESS_PREFLIGHT_COMPAT_COLUMNS,
  access_runtime_state: [
    'id:integer:0',
    'minimum_protocol:integer:0',
    'revision:integer:0',
    'role_publishing_enabled:integer:0',
    'schema_mode:text:0',
  ],
};
const schemaProjection = (tables: string[]) =>
  `json_object(${tables
    .flatMap((table) => [
      `'${table}'`,
      `json((SELECT json_group_array(CASE WHEN length(CAST(name AS BLOB)) <= 64 AND length(CAST(type AS BLOB)) <= 16 THEN name || ':' || lower(type) || ':' || hidden ELSE '!unsupported' END) FROM (SELECT name,type,hidden FROM pragma_table_xinfo('${table}') ORDER BY name LIMIT 65)))`,
    ])
    .join(',')})`;
const tableProjection = (tables: string[]) =>
  `json_object(${tables.flatMap((table) => [`'${table}'`, `(SELECT type FROM sqlite_schema WHERE name='${table}')`]).join(',')})`;
const futureTables = `(SELECT json_group_array(name) FROM (SELECT lower(name) AS name FROM sqlite_schema WHERE type IN ('table','view') AND lower(name) IN ('team_members','repository_team_grants') ORDER BY name LIMIT 3))`;
/** Discovery chooses a static query only; final data reads repeat the schema and marker checks. */
export function accessPreflightDiscoveryQuery() {
  const tables = Object.keys(ACCESS_PREFLIGHT_BRIDGE_COLUMNS);
  return {
    sql: `SELECT json_object('schema',${schemaProjection(tables)},'tableTypes',${tableProjection(tables)},'unsupportedTables',json(${futureTables})) AS schemaDiscovery`,
    params: [] as (string | number)[],
  };
}
export function classifyAccessSchema(
  raw: unknown
): AccessSchemaVersion | 'unsupported' {
  try {
    if (
      typeof raw !== 'string' ||
      new TextEncoder().encode(raw).length > 32_000
    )
      return 'unsupported';
    const data = object(JSON.parse(raw), [
      'schema',
      'tableTypes',
      'unsupportedTables',
    ]);
    const tables = Object.keys(ACCESS_PREFLIGHT_BRIDGE_COLUMNS);
    const metadata = object(data.schema, tables);
    const types = object(data.tableTypes, tables);
    if (!Array.isArray(data.unsupportedTables) || data.unsupportedTables.length)
      return 'unsupported';
    for (const version of [
      'legacy',
      'compat-v1',
      'runtime-bridge-v1',
    ] as const) {
      const expected =
        version === 'legacy'
          ? ACCESS_PREFLIGHT_LEGACY_COLUMNS
          : version === 'compat-v1'
            ? ACCESS_PREFLIGHT_COMPAT_COLUMNS
            : ACCESS_PREFLIGHT_BRIDGE_COLUMNS;
      if (
        tables.every((table) => {
          const columns = expected[table as keyof typeof expected];
          const actual = metadata[table];
          return (
            Array.isArray(actual) &&
            actual.every((v) => typeof v === 'string') &&
            JSON.stringify([...actual].sort()) ===
              JSON.stringify(columns ?? []) &&
            types[table] === (columns ? 'table' : null)
          );
        })
      )
        return version;
    }
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

type LegacyTable = keyof typeof ACCESS_PREFLIGHT_LEGACY_COLUMNS;
type Field = readonly [
  name: string,
  column: string,
  rawBytes: number,
  jsonBytes: number,
  nullable?: boolean,
];
const fields = {
  users: [
    ['id', 'id', 64, 96],
    ['username', 'username', 39, 96, true],
    ['role', 'role', 16, 32, true],
  ],
  teams: [
    ['id', 'id', 64, 96],
    ['slug', 'slug', 39, 96],
  ],
  repositories: [
    ['id', 'id', 64, 96],
    ['ownerId', 'owner_id', 64, 96],
    ['teamId', 'team_id', 64, 96, true],
    ['name', 'name', 100, 128],
    ['artifactsName', 'artifacts_name', 128, 128],
    ['visibility', 'visibility', 16, 24],
  ],
  collaborators: [
    ['repositoryId', 'repository_id', 64, 96],
    ['userId', 'user_id', 64, 96],
  ],
  agents: [
    ['userId', 'user_id', 64, 96],
    ['repositoryId', 'repository_id', 64, 96, true],
  ],
} as const satisfies Record<string, readonly Field[]>;

// The nested CASE checks the raw size before json_quote can expand escaping. Both bounds are needed
// to stay below D1's 2 MB row/string limit even for hostile legacy control characters.
const boundedText = ([, column, raw, encoded]: Field) =>
  `CASE WHEN typeof(${column}) = 'text' AND length(CAST(${column} AS BLOB)) <= ${raw} THEN CASE WHEN length(CAST(json_quote(${column}) AS BLOB)) <= ${encoded} THEN ${column} END END`;

/** One statement observes schema, marker and data together; this is not an authorization for a later apply. */
export function accessPreflightQuery(
  installation?: AccessInstallation,
  schemaVersion: AccessSchemaVersion = 'legacy'
): {
  sql: string;
  params: (string | number)[];
} {
  if (schemaVersion === 'runtime-bridge-v1')
    return bridgePreflightQuery(installation);
  if (schemaVersion === 'compat-v1') return compatPreflightQuery(installation);
  return legacyPreflightQuery(installation);
}

// Nested projections defer the complete DDL predicate to their final schema version.
// Only the public legacy query evaluates the legacy definition; never duplicate full guards.
function legacyPreflightQuery(
  installation?: AccessInstallation,
  nested = false
) {
  const collections = Object.entries(fields).map(([name, columns]) => {
    const table = name === 'collaborators' ? 'repository_collaborators' : name;
    const values = columns.map(
      (field) => `${boundedText(field)} AS "${field[0]}"`
    );
    const invalid = columns.map((field) =>
      field[4]
        ? `(${field[1]} IS NOT NULL AND ${boundedText(field)} IS NULL)`
        : `(${boundedText(field)} IS NULL)`
    );
    if (name === 'users') {
      values.push(
        'CASE WHEN banned IN (0, 1) OR banned IS NULL THEN banned END AS banned'
      );
      invalid.push(
        "(banned IS NOT NULL AND (typeof(banned) != 'integer' OR banned NOT IN (0, 1)))"
      );
    }
    values.push(
      `CASE WHEN ${invalid.join(' OR ')} THEN 1 ELSE 0 END AS invalid`
    );
    const order =
      name === 'collaborators'
        ? 'repository_id, user_id'
        : name === 'agents'
          ? 'user_id'
          : 'id';
    return `${name}_snapshot AS (SELECT ${values.join(', ')} FROM ${table} ORDER BY ${order} LIMIT ${ACCESS_PREFLIGHT_LIMIT + 1})`;
  });
  const arrays = Object.entries(fields).map(([name, columns]) => {
    const pairs = columns.flatMap(([field]) => [`'${field}'`, `"${field}"`]);
    if (name === 'users') pairs.push("'banned'", 'banned');
    return `'${name}', json((SELECT json_group_array(json_object(${pairs.join(', ')})) FROM ${name}_snapshot))`;
  });
  const schema = Object.keys(ACCESS_PREFLIGHT_LEGACY_COLUMNS).flatMap(
    (table) => [
      `'${table}'`,
      `json((SELECT json_group_array(CASE WHEN length(CAST(name AS BLOB)) <= 64 AND length(CAST(type AS BLOB)) <= 16 THEN name || ':' || lower(type) || ':' || hidden ELSE '!unsupported' END) FROM (SELECT name, type, hidden FROM pragma_table_xinfo('${table}') ORDER BY name LIMIT 65)))`,
    ]
  );
  const tableTypes = Object.keys(ACCESS_PREFLIGHT_LEGACY_COLUMNS).map(
    (table) =>
      `(SELECT type FROM sqlite_schema WHERE name = '${table}') = 'table'`
  );
  return {
    sql: `WITH ${collections.join(',\n')}
SELECT json_object(
  'format', 1,
  'definitionValid', ${nested ? '1' : accessDefinitionGuardSql('legacy')},
  'marker', json_object('count', (SELECT count(*) FROM install_state), 'valid',
    CASE WHEN ? = 1 THEN CASE WHEN ${installation?.allowMissing ? '(SELECT count(*) FROM install_state) = 0 OR ' : ''}(SELECT count(*) FROM install_state) = 1 AND EXISTS (SELECT 1 FROM install_state WHERE installation_id = ? AND ownership_nonce = ?) THEN 1 ELSE 0 END
    ELSE CASE WHEN (SELECT count(*) FROM install_state) <= 1 THEN 1 ELSE 0 END END),
  'schema', json_object(${schema.join(', ')}),
  'tableTypesValid', CASE WHEN ${tableTypes.join(' AND ')} THEN 1 ELSE 0 END,
  'unsupportedTables', json((SELECT json_group_array(name) FROM (SELECT lower(name) AS name FROM sqlite_schema WHERE type IN ('table','view') AND lower(name) IN ('access_control_state','team_members','repository_team_grants','namespace_claims','access_runtime_state') ORDER BY name LIMIT 6))),
  'invalidFields', CASE WHEN ${Object.keys(fields)
    .map((name) => `EXISTS (SELECT 1 FROM ${name}_snapshot WHERE invalid = 1)`)
    .join(' OR ')} THEN 1 ELSE 0 END,
  ${arrays.join(',\n  ')}
) AS snapshot`,
    params: [
      installation ? 1 : 0,
      installation?.id ?? '',
      installation?.ownershipNonce ?? '',
    ],
  };
}

type User = {
  id: string;
  username: string | null;
  role: string | null;
  banned: number | null;
};
type Team = { id: string; slug: string };
type Repository = {
  id: string;
  ownerId: string;
  teamId: string | null;
  name: string;
  artifactsName: string;
  visibility: 'private' | 'internal' | 'public';
};
type Collaborator = { repositoryId: string; userId: string };
type Agent = { userId: string; repositoryId: string | null };
export type AccessPreflightSnapshot = {
  format: 1 | 2 | 3;
  definitionValid: boolean;
  compat?: AccessCompatSnapshot;
  runtime?: AccessRuntimeSnapshot;
  marker: { count: number; valid: boolean };
  schema: Record<string, string[]>;
  tableTypesValid: boolean;
  unsupportedTables: string[];
  invalidFields: boolean;
  users: User[];
  teams: Team[];
  repositories: Repository[];
  collaborators: Collaborator[];
  agents: Agent[];
};
export type AccessPreflightIssue = {
  code: string;
  count: number;
  samples: { id: string; relatedId?: string }[];
  message: string;
};
export type AccessPreflightAnalysis = {
  snapshot: AccessPreflightSnapshot;
  report: {
    schemaVersion: AccessSchemaVersion;
    accessGeneration: number | null;
    runtime?: AccessRuntimeSnapshot;
    counts: {
      users: number;
      teams: number;
      repositories: number;
      collaborators: number;
      agents: number;
      teamRepositories: number;
      publicRepositories: number;
      publicTeamRepositories: number;
      activeHumanSiteAdmins: number;
    };
    legacySharedTeamId: string | null;
    compatibility: {
      legacyCollaboratorsBackfillRole: 'write';
      legacyCollaboratorCount: number;
      preserveOwnerCreatorAdmin: true;
      newRolesEnabled: false;
      rollbackSafe: false;
    };
    publicRepositoryIds: string[];
    blockers: AccessPreflightIssue[];
    warnings: AccessPreflightIssue[];
  };
  blocked: boolean;
  rolePublishingAllowed: false;
  migrationApplied: false;
};

const fail = (message: string): never => {
  throw new Error(`Access preflight refused: ${message}`);
};
function object(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('malformed snapshot object');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('\0') !== [...keys].sort().join('\0'))
    return fail('unexpected snapshot fields');
  return row;
}
function boolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return fail('malformed boolean');
}
function text(
  value: unknown,
  raw: number,
  encoded: number,
  nullable = false
): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'string' ||
    !value.length ||
    new TextEncoder().encode(value).length > raw ||
    new TextEncoder().encode(JSON.stringify(value)).length > encoded
  )
    return fail('malformed or oversized access field');
  return value;
}
function rows<T>(
  value: unknown,
  parse: (row: unknown) => T,
  key: (row: T) => string
): T[] {
  if (!Array.isArray(value) || value.length > ACCESS_PREFLIGHT_LIMIT)
    return fail(
      `collection exceeds supported ${ACCESS_PREFLIGHT_LIMIT}-row snapshot limit or is malformed`
    );
  const parsed = value
    .map(parse)
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  if (new Set(parsed.map(key)).size !== parsed.length)
    return fail('duplicate access identities');
  return parsed;
}

/** All output excludes credentials, email addresses and ownership nonce; no inferred grant is written. */
export function analyzeAccessSnapshot(raw: unknown): AccessPreflightAnalysis {
  let value: unknown;
  try {
    const encoded = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (
      !encoded ||
      new TextEncoder().encode(encoded).length > ACCESS_PREFLIGHT_MAX_BYTES
    )
      return fail('snapshot exceeds supported byte limit');
    value = JSON.parse(encoded);
  } catch {
    return fail('snapshot is not bounded JSON');
  }
  if (
    value &&
    typeof value === 'object' &&
    'format' in value &&
    value.format === 3
  )
    return analyzeBridgeSnapshot(value);
  if (
    value &&
    typeof value === 'object' &&
    'format' in value &&
    value.format === 2
  )
    return analyzeCompatSnapshot(value);
  const data = object(value, [
    'format',
    'definitionValid',
    'marker',
    'schema',
    'tableTypesValid',
    'unsupportedTables',
    'invalidFields',
    ...Object.keys(fields),
  ]);
  if (
    data.format !== 1 ||
    !boolean(data.definitionValid) ||
    !boolean(data.tableTypesValid) ||
    boolean(data.invalidFields)
  )
    return fail('unsupported schema or invalid/oversized stored fields');
  if (!Array.isArray(data.unsupportedTables) || data.unsupportedTables.length)
    return fail(
      'new ACL schema requires a version-aware preflight; legacy write backfill is not inferred'
    );
  const metadata = object(
    data.schema,
    Object.keys(ACCESS_PREFLIGHT_LEGACY_COLUMNS)
  );
  const schema = {} as AccessPreflightSnapshot['schema'];
  for (const [table, expected] of Object.entries(
    ACCESS_PREFLIGHT_LEGACY_COLUMNS
  )) {
    const actual = metadata[table];
    if (
      !Array.isArray(actual) ||
      actual.some((column) => typeof column !== 'string') ||
      JSON.stringify([...actual].sort()) !== JSON.stringify(expected)
    )
      return fail(`unsupported ${table} schema; no legacy roles inferred`);
    schema[table as LegacyTable] = [...actual].sort();
  }
  const marker = object(data.marker, ['count', 'valid']);
  if (
    !Number.isSafeInteger(marker.count) ||
    Number(marker.count) < 0 ||
    Number(marker.count) > 1 ||
    !boolean(marker.valid)
  )
    return fail('installation marker mismatch or ambiguity');
  const parse = (name: keyof typeof fields, value: unknown) => {
    const columns: readonly Field[] = fields[name];
    const row = object(value, [
      ...columns.map(([key]) => key),
      ...(name === 'users' ? ['banned'] : []),
    ]);
    const out: Record<string, string | number | null> = {};
    for (const [key, , rawBytes, jsonBytes, nullable] of columns)
      out[key] = text(row[key], rawBytes, jsonBytes, nullable);
    if (name === 'users') {
      if (row.banned !== null && row.banned !== 0 && row.banned !== 1)
        return fail('malformed banned state');
      out.banned = row.banned;
    }
    return out;
  };
  const users = rows(
    data.users,
    (row) => parse('users', row) as User,
    (row) => row.id
  );
  const teams = rows(
    data.teams,
    (row) => parse('teams', row) as Team,
    (row) => row.id
  );
  const repositories = rows(
    data.repositories,
    (row) => parse('repositories', row) as Repository,
    (row) => row.id
  );
  if (
    repositories.some(
      (repo) => !['private', 'internal', 'public'].includes(repo.visibility)
    )
  )
    return fail('unsupported repository visibility');
  const collaborators = rows(
    data.collaborators,
    (row) => parse('collaborators', row) as Collaborator,
    (row) => `${row.repositoryId}\0${row.userId}`
  );
  const agents = rows(
    data.agents,
    (row) => parse('agents', row) as Agent,
    (row) => row.userId
  );
  const snapshot: AccessPreflightSnapshot = {
    format: 1,
    definitionValid: true,
    marker: { count: Number(marker.count), valid: true },
    schema,
    tableTypesValid: true,
    unsupportedTables: [],
    invalidFields: false,
    users,
    teams,
    repositories,
    collaborators,
    agents,
  };
  const blockers: AccessPreflightIssue[] = [];
  const warnings: AccessPreflightIssue[] = [];
  const add = (
    list: AccessPreflightIssue[],
    code: string,
    message: string,
    id: string,
    relatedId?: string
  ) => {
    let issue = list.find((item) => item.code === code);
    if (!issue) {
      issue = { code, message, count: 0, samples: [] };
      list.push(issue);
    }
    issue.count++;
    if (issue.samples.length < SAMPLE_LIMIT)
      issue.samples.push({
        id,
        ...(relatedId === undefined ? {} : { relatedId }),
      });
  };
  const people = new Map(users.map((person) => [person.id, person]));
  const teamIds = new Set(teams.map((team) => team.id));
  const repos = new Map(repositories.map((repo) => [repo.id, repo]));
  const agentIds = new Map(agents.map((agent) => [agent.userId, agent]));
  if (teams.length > 1)
    for (const team of teams)
      add(
        blockers,
        'multiple_legacy_teams',
        'More than one old shared team; no compatibility team can be selected automatically.',
        team.id
      );
  const namespaces = new Map<string, { kind: string; id: string }>();
  for (const person of users) {
    if (
      person.role !== null &&
      person.role !== 'user' &&
      person.role !== 'admin'
    )
      add(
        blockers,
        'unsupported_member_role',
        'Unknown member role cannot be interpreted as an administrator or a new repository role.',
        person.id
      );
    if (person.username === null) {
      add(
        warnings,
        'member_without_username',
        'No namespace claim can be inferred for a null username; membership itself is retained.',
        person.id
      );
      continue;
    }
    if (!isValidUsername(person.username))
      add(
        blockers,
        'invalid_member_namespace',
        'Username is outside the current valid namespace contract.',
        person.id
      );
    const key = person.username.toLowerCase();
    const previous = namespaces.get(key);
    if (previous)
      add(
        blockers,
        'namespace_collision',
        'Normalized usernames and team slugs must be unique.',
        person.id,
        previous.id
      );
    else namespaces.set(key, { kind: 'user', id: person.id });
  }
  for (const team of teams) {
    if (!isValidUsername(team.slug) || team.slug !== team.slug.toLowerCase())
      add(
        blockers,
        'invalid_team_namespace',
        'Team slug must already be valid and normalized; it is not silently rewritten.',
        team.id
      );
    const key = team.slug.toLowerCase();
    const previous = namespaces.get(key);
    if (previous)
      add(
        blockers,
        'namespace_collision',
        'Normalized usernames and team slugs must be unique.',
        team.id,
        previous.id
      );
    else namespaces.set(key, { kind: 'team', id: team.id });
  }
  for (const repo of repositories) {
    const owner = people.get(repo.ownerId);
    if (!owner)
      add(
        blockers,
        'missing_repository_owner',
        'Repository owner/creator is absent.',
        repo.id,
        repo.ownerId
      );
    else {
      if (owner.banned)
        add(
          warnings,
          'banned_repository_owner',
          'Preserve the dormant owner/creator reference; do not silently restore or discard it.',
          repo.id,
          owner.id
        );
      if (!repo.teamId && owner.username === null)
        add(
          blockers,
          'unaddressable_personal_repository',
          'Personal repository owner has no URL namespace.',
          repo.id,
          owner.id
        );
      const agent = agentIds.get(owner.id);
      if (agent && (repo.teamId !== null || agent.repositoryId !== repo.id))
        add(
          blockers,
          'unexpected_agent_repository_owner',
          'Agent ownership does not match its personal configuration repository.',
          repo.id,
          owner.id
        );
    }
    if (repo.teamId !== null && !teamIds.has(repo.teamId))
      add(
        blockers,
        'missing_repository_team',
        'Repository team reference is absent.',
        repo.id,
        repo.teamId
      );
    if (repo.teamId !== null && repo.visibility === 'private')
      add(
        blockers,
        'legacy_team_private',
        'Legacy team-private rows are member-readable today; automatic classification would misstate their visibility.',
        repo.id,
        repo.teamId
      );
  }
  for (const row of collaborators) {
    if (!repos.has(row.repositoryId))
      add(
        blockers,
        'missing_collaborator_repository',
        'Collaborator repository reference is absent.',
        row.repositoryId,
        row.userId
      );
    const person = people.get(row.userId);
    if (!person)
      add(
        blockers,
        'missing_collaborator_user',
        'Collaborator member reference is absent.',
        row.repositoryId,
        row.userId
      );
    else if (person.banned)
      add(
        warnings,
        'banned_collaborator',
        'Retain the dormant legacy write grant; unbanning remains an independent action.',
        row.repositoryId,
        row.userId
      );
    if (agentIds.has(row.userId))
      add(
        blockers,
        'agent_collaborator',
        'Reviewer agents are not human role-grant subjects; no conversion is inferred.',
        row.repositoryId,
        row.userId
      );
  }
  for (const agent of agents) {
    if (!people.has(agent.userId))
      add(
        blockers,
        'missing_agent_user',
        'Agent member reference is absent.',
        agent.userId
      );
    if (agent.repositoryId !== null && !repos.has(agent.repositoryId))
      add(
        blockers,
        'missing_agent_repository',
        'Agent configuration repository reference is absent.',
        agent.userId,
        agent.repositoryId
      );
    const config =
      agent.repositoryId === null ? undefined : repos.get(agent.repositoryId);
    if (config && (config.ownerId !== agent.userId || config.teamId !== null))
      add(
        blockers,
        'invalid_agent_configuration_repository',
        'Agent configuration must reference its own personal repository; no human or team role conversion is inferred.',
        agent.userId,
        config.id
      );
  }
  const activeHumanSiteAdmins = users.filter(
    (person) =>
      person.role === 'admin' && !person.banned && !agentIds.has(person.id)
  ).length;
  if (!activeHumanSiteAdmins)
    add(
      warnings,
      'no_active_human_site_admin',
      users.length
        ? 'No unbanned human site-admin row. Local password/MFA recovery is not verified by this preflight.'
        : 'Empty/unclaimed database; no administrator or local recovery path has been verified.',
      'instance'
    );
  add(
    warnings,
    'recovery_credentials_unverified',
    'Only member role/ban state is inspected. Password, MFA, sessions and local recovery usability are not inspected.',
    'instance'
  );
  add(
    warnings,
    'role_release_and_rollback_unverified',
    'No role publication or migration is authorized. Future read/triage grants require version-aware runtime and rollback guards.',
    'instance'
  );
  const publicRepositoryIds = repositories
    .filter((repo) => repo.visibility === 'public')
    .map((repo) => repo.id);
  return {
    snapshot,
    report: {
      schemaVersion: 'legacy',
      accessGeneration: null,
      counts: {
        users: users.length,
        teams: teams.length,
        repositories: repositories.length,
        collaborators: collaborators.length,
        agents: agents.length,
        teamRepositories: repositories.filter((repo) => repo.teamId !== null)
          .length,
        publicRepositories: publicRepositoryIds.length,
        publicTeamRepositories: repositories.filter(
          (repo) => repo.teamId !== null && repo.visibility === 'public'
        ).length,
        activeHumanSiteAdmins,
      },
      legacySharedTeamId: teams.length === 1 ? teams[0].id : null,
      compatibility: {
        legacyCollaboratorsBackfillRole: 'write',
        legacyCollaboratorCount: collaborators.length,
        preserveOwnerCreatorAdmin: true,
        newRolesEnabled: false,
        rollbackSafe: false,
      },
      publicRepositoryIds,
      blockers,
      warnings,
    },
    blocked: blockers.length > 0,
    rolePublishingAllowed: false,
    migrationApplied: false,
  };
}
type AccessCompatSnapshot = {
  state: {
    id: number;
    generation: number;
    legacySharedTeamId: string | null;
  }[];
  teams: { id: string; membershipMode: string; revision: number }[];
  collaborators: {
    repositoryId: string;
    userId: string;
    role: string;
    revision: number;
  }[];
  claims: { slug: string; kind: string; subjectId: string }[];
  triggersValid: boolean;
};
const boundedInteger = (column: string) =>
  `CASE WHEN typeof(${column})='integer' AND ${column}>=0 AND ${column}<=9007199254740991 THEN ${column} END`;
function compatPreflightQuery(
  installation?: AccessInstallation,
  version: 'compat-v1' | 'runtime-bridge-v1' = 'compat-v1'
) {
  const base = legacyPreflightQuery(installation, true);
  const bt = (column: string, raw = 64, encoded = 96) =>
    boundedText(['', column, raw, encoded]);
  const collection = (table: string, order: string, pairs: string) =>
    `json((SELECT json_group_array(json_object(${pairs})) FROM (SELECT * FROM ${table} ORDER BY ${order} LIMIT 1001)))`;
  const tables = Object.keys(ACCESS_PREFLIGHT_COMPAT_COLUMNS);
  return {
    sql: `WITH legacy_snapshot AS (${base.sql})
SELECT CASE WHEN length(CAST(snapshot AS BLOB)) + 8192
  + 256*(SELECT count(*) FROM (SELECT 1 FROM access_control_state LIMIT 1001))
  + 256*(SELECT count(*) FROM (SELECT 1 FROM teams LIMIT 1001))
  + 384*(SELECT count(*) FROM (SELECT 1 FROM repository_collaborators LIMIT 1001))
  + 384*(SELECT count(*) FROM (SELECT 1 FROM namespace_claims LIMIT 1001)) <= ${ACCESS_PREFLIGHT_MAX_BYTES}
THEN json_set(snapshot,
  '$.format',2,
  '$.definitionValid',${accessDefinitionGuardSql(version)},
  '$.schema',json(${schemaProjection(tables)}),
  '$.tableTypesValid',CASE WHEN ${tables.map((table) => `(SELECT type FROM sqlite_schema WHERE name='${table}')='table'`).join(' AND ')} THEN 1 ELSE 0 END,
  '$.unsupportedTables',json((SELECT json_group_array(name) FROM (SELECT lower(name) AS name FROM sqlite_schema WHERE type IN ('table','view') AND lower(name) IN ('team_members','repository_team_grants','access_runtime_state') ORDER BY name LIMIT 4))),
  '$.compat',json_object(
    'state',${collection('access_control_state', 'id', `'id',${boundedInteger('id')},'generation',${boundedInteger('generation')},'legacySharedTeamId',${bt('legacy_shared_team_id')}`)},
    'teams',${collection('teams', 'id', `'id',${bt('id')},'membershipMode',${bt('membership_mode', 16, 32)},'revision',${boundedInteger('revision')}`)},
    'collaborators',${collection('repository_collaborators', 'repository_id,user_id', `'repositoryId',${bt('repository_id')},'userId',${bt('user_id')},'role',${bt('role', 16, 32)},'revision',${boundedInteger('revision')}`)},
    'claims',${collection('namespace_claims', 'slug', `'slug',${bt('slug', 39, 96)},'kind',${bt('kind', 16, 32)},'subjectId',${bt('subject_id')}`)},
    'triggersValid',CASE WHEN (SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND substr(lower(name),1,18) = 'cloudforge_access_') = ${ACCESS_TRIGGERS.length}
      AND NOT EXISTS (SELECT 1 FROM json_each(?) expected LEFT JOIN sqlite_schema actual ON actual.name=json_extract(expected.value,'$.name') AND actual.type='trigger' WHERE actual.sql IS NULL OR (trim(actual.sql, char(10)||char(13)||' ;') != trim(json_extract(expected.value,'$.sql'),char(10)||char(13)||' ;') AND trim(actual.sql, char(10)||char(13)||' ;') != trim(replace(json_extract(expected.value,'$.sql'),char(10),char(13)||char(10)),char(10)||char(13)||' ;')))
      AND NOT EXISTS(SELECT 1 FROM access_control_state WHERE legacy_shared_team_id IS NOT NULL AND ${bt('legacy_shared_team_id')} IS NULL)
      THEN 1 ELSE 0 END
  )) ELSE '{}' END AS snapshot FROM legacy_snapshot`,
    params: [...base.params, JSON.stringify(ACCESS_TRIGGERS)],
  };
}
function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    return fail('invalid access generation/revision');
  return Number(value);
}
function analyzeCompatSnapshot(value: unknown): AccessPreflightAnalysis {
  const data = object(value, [
    'format',
    'definitionValid',
    'marker',
    'schema',
    'tableTypesValid',
    'unsupportedTables',
    'invalidFields',
    ...Object.keys(fields),
    'compat',
  ]);
  const schema = object(
    data.schema,
    Object.keys(ACCESS_PREFLIGHT_COMPAT_COLUMNS)
  );
  for (const [table, expected] of Object.entries(
    ACCESS_PREFLIGHT_COMPAT_COLUMNS
  )) {
    const actual = schema[table];
    if (
      !Array.isArray(actual) ||
      actual.some((v) => typeof v !== 'string') ||
      JSON.stringify([...actual].sort()) !== JSON.stringify(expected)
    )
      return fail('unsupported compatible schema');
  }
  const metadata = object(data.compat, [
    'state',
    'teams',
    'collaborators',
    'claims',
    'triggersValid',
  ]);
  if (!boolean(metadata.triggersValid))
    return fail('access trigger integrity mismatch');
  const state = rows(
    metadata.state,
    (raw) => {
      const row = object(raw, ['id', 'generation', 'legacySharedTeamId']);
      return {
        id: safeInteger(row.id),
        generation: safeInteger(row.generation),
        legacySharedTeamId: text(row.legacySharedTeamId, 64, 96, true),
      };
    },
    (row) => String(row.id)
  );
  if (state.length !== 1 || state[0].id !== 1)
    return fail('access state singleton missing or ambiguous');
  const teams = rows(
    metadata.teams,
    (raw) => {
      const row = object(raw, ['id', 'membershipMode', 'revision']);
      return {
        id: text(row.id, 64, 96)!,
        membershipMode: text(row.membershipMode, 16, 32)!,
        revision: safeInteger(row.revision),
      };
    },
    (row) => row.id
  );
  const collaborators = rows(
    metadata.collaborators,
    (raw) => {
      const row = object(raw, ['repositoryId', 'userId', 'role', 'revision']);
      return {
        repositoryId: text(row.repositoryId, 64, 96)!,
        userId: text(row.userId, 64, 96)!,
        role: text(row.role, 16, 32)!,
        revision: safeInteger(row.revision),
      };
    },
    (row) => `${row.repositoryId}\0${row.userId}`
  );
  const claims = rows(
    metadata.claims,
    (raw) => {
      const row = object(raw, ['slug', 'kind', 'subjectId']);
      return {
        slug: text(row.slug, 39, 96)!,
        kind: text(row.kind, 16, 32)!,
        subjectId: text(row.subjectId, 64, 96)!,
      };
    },
    (row) => row.slug
  );
  const { compat: _compat, ...base } = data;
  // Reuse legacy data anomaly checks only after the expanded schema and its extra state are validated.
  const result = analyzeAccessSnapshot({
    ...base,
    format: 1,
    schema: ACCESS_PREFLIGHT_LEGACY_COLUMNS,
  });
  const add = (code: string, message: string, id: string) => {
    let item = result.report.blockers.find((item) => item.code === code);
    if (!item) {
      item = { code, message, count: 0, samples: [] };
      result.report.blockers.push(item);
    }
    item.count++;
    if (item.samples.length < SAMPLE_LIMIT) item.samples.push({ id });
  };
  for (const team of teams)
    if (team.membershipMode !== 'instance')
      add(
        'unsupported_team_membership',
        'Only the instance shared team is supported.',
        team.id
      );
  for (const row of collaborators)
    if (row.role !== 'write')
      add(
        'unsupported_collaborator_role',
        'Only existing write grants are supported.',
        row.repositoryId
      );
  if (
    JSON.stringify(teams.map((row) => row.id)) !==
      JSON.stringify(result.snapshot.teams.map((row) => row.id)) ||
    JSON.stringify(
      collaborators.map((row) => [row.repositoryId, row.userId])
    ) !==
      JSON.stringify(
        result.snapshot.collaborators.map((row) => [
          row.repositoryId,
          row.userId,
        ])
      )
  )
    return fail('inconsistent compatible snapshot');
  if (state[0].legacySharedTeamId !== result.report.legacySharedTeamId)
    add(
      'invalid_legacy_team_pointer',
      'The stable shared-team pointer does not match the current single instance team.',
      'instance'
    );
  const expected = new Map<string, { kind: string; subjectId: string }>();
  for (const user of result.snapshot.users)
    if (user.username !== null)
      expected.set(user.username.toLowerCase(), {
        kind: 'user',
        subjectId: user.id,
      });
  for (const team of teams) {
    const row = result.snapshot.teams.find((row) => row.id === team.id)!;
    expected.set(row.slug, { kind: 'team', subjectId: row.id });
  }
  for (const claim of claims) {
    const match = expected.get(claim.slug);
    if (
      !match ||
      match.kind !== claim.kind ||
      match.subjectId !== claim.subjectId
    )
      add(
        'namespace_claim_mismatch',
        'Namespace claims must exactly match their current source identities.',
        claim.subjectId
      );
    else expected.delete(claim.slug);
  }
  for (const missing of expected.values())
    add(
      'namespace_claim_missing',
      'A source identity has no matching namespace claim.',
      missing.subjectId
    );
  result.snapshot = {
    ...result.snapshot,
    format: 2,
    schema: schema as Record<string, string[]>,
    compat: { state, teams, collaborators, claims, triggersValid: true },
  };
  result.report.schemaVersion = 'compat-v1';
  result.report.accessGeneration = state[0].generation;
  result.blocked = result.report.blockers.length > 0;
  return result;
}

type AccessRuntimeSnapshot = {
  minimumProtocol: number;
  schemaMode: 'compat-v1';
  rolePublishingEnabled: false;
  revision: number;
};

function bridgePreflightQuery(installation?: AccessInstallation) {
  const base = compatPreflightQuery(installation, 'runtime-bridge-v1');
  const tables = Object.keys(ACCESS_PREFLIGHT_BRIDGE_COLUMNS);
  return {
    sql: `WITH compat_snapshot AS (${base.sql})
SELECT CASE WHEN length(CAST(snapshot AS BLOB)) + 2048 <= ${ACCESS_PREFLIGHT_MAX_BYTES}
THEN json_set(snapshot,
  '$.format',3,
  '$.schema',json(${schemaProjection(tables)}),
  '$.tableTypesValid',CASE WHEN ${tables.map((table) => `(SELECT type FROM sqlite_schema WHERE name='${table}')='table'`).join(' AND ')} THEN 1 ELSE 0 END,
  '$.unsupportedTables',json(${futureTables}),
  '$.runtime',json_object(
    'state',json((SELECT json_group_array(json_object('id',${boundedInteger('id')},'minimumProtocol',${boundedInteger('minimum_protocol')},'schemaMode',${boundedText(['', 'schema_mode', 16, 32])},'rolePublishingEnabled',${boundedInteger('role_publishing_enabled')},'revision',${boundedInteger('revision')})) FROM (SELECT * FROM access_runtime_state ORDER BY id LIMIT 2))),
    'triggersValid',CASE WHEN (SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND substr(lower(name),1,19) = 'cloudforge_runtime_') = ${ACCESS_RUNTIME_TRIGGERS.length}
      AND NOT EXISTS (SELECT 1 FROM json_each(?) expected LEFT JOIN sqlite_schema actual ON actual.name=json_extract(expected.value,'$.name') AND actual.type='trigger' WHERE actual.sql IS NULL OR (trim(actual.sql,char(10)||char(13)||' ;') != trim(json_extract(expected.value,'$.sql'),char(10)||char(13)||' ;') AND trim(actual.sql,char(10)||char(13)||' ;') != trim(replace(json_extract(expected.value,'$.sql'),char(10),char(13)||char(10)),char(10)||char(13)||' ;')))
      THEN 1 ELSE 0 END
  )) ELSE '{}' END AS snapshot FROM compat_snapshot`,
    params: [...base.params, JSON.stringify(ACCESS_RUNTIME_TRIGGERS)],
  };
}

function analyzeBridgeSnapshot(value: unknown): AccessPreflightAnalysis {
  const data = object(value, [
    'format',
    'definitionValid',
    'marker',
    'schema',
    'tableTypesValid',
    'unsupportedTables',
    'invalidFields',
    ...Object.keys(fields),
    'compat',
    'runtime',
  ]);
  const schema = object(
    data.schema,
    Object.keys(ACCESS_PREFLIGHT_BRIDGE_COLUMNS)
  );
  for (const [table, expected] of Object.entries(
    ACCESS_PREFLIGHT_BRIDGE_COLUMNS
  )) {
    const actual = schema[table];
    if (
      !Array.isArray(actual) ||
      actual.some((column) => typeof column !== 'string') ||
      JSON.stringify([...actual].sort()) !== JSON.stringify(expected)
    )
      return fail('unsupported runtime bridge schema');
  }
  const metadata = object(data.runtime, ['state', 'triggersValid']);
  if (!boolean(metadata.triggersValid))
    return fail('runtime trigger integrity mismatch');
  if (!Array.isArray(metadata.state) || metadata.state.length !== 1)
    return fail('runtime singleton missing or ambiguous');
  const row = object(metadata.state[0], [
    'id',
    'minimumProtocol',
    'schemaMode',
    'rolePublishingEnabled',
    'revision',
  ]);
  if (
    row.id !== 1 ||
    row.schemaMode !== 'compat-v1' ||
    row.rolePublishingEnabled !== 0
  )
    return fail('unsupported runtime mode or role publication');
  const minimumProtocol = safeInteger(row.minimumProtocol);
  if (minimumProtocol < 1) return fail('invalid minimum runtime protocol');
  const runtime: AccessRuntimeSnapshot = {
    minimumProtocol,
    schemaMode: 'compat-v1',
    rolePublishingEnabled: false,
    revision: safeInteger(row.revision),
  };
  const { runtime: _runtime, ...base } = data;
  const result = analyzeCompatSnapshot({
    ...base,
    format: 2,
    schema: ACCESS_PREFLIGHT_COMPAT_COLUMNS,
  });
  if (minimumProtocol > 1)
    result.report.blockers.push({
      code: 'unsupported_runtime_protocol',
      message:
        'The database requires a newer runtime protocol than this release supports.',
      count: 1,
      samples: [{ id: 'instance' }],
    });
  result.snapshot = {
    ...result.snapshot,
    format: 3,
    schema: schema as Record<string, string[]>,
    runtime,
  };
  result.report.schemaVersion = 'runtime-bridge-v1';
  result.report.runtime = runtime;
  result.blocked = result.report.blockers.length > 0;
  return result;
}
