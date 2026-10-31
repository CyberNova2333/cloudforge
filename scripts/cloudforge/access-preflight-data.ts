// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { isValidUsername } from '../../worker/src/lib/usernames.ts';

export const ACCESS_PREFLIGHT_LIMIT = 1000;
export const ACCESS_PREFLIGHT_MAX_BYTES = 1_800_000;
const SAMPLE_LIMIT = 20;

/** Only this legacy schema is understood. An expanded ACL must never be read as legacy write grants. */
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
export function accessPreflightQuery(installation?: {
  id: string;
  ownershipNonce: string;
}): {
  sql: string;
  params: (string | number)[];
} {
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
  'marker', json_object('count', (SELECT count(*) FROM install_state), 'valid',
    CASE WHEN ? = 1 THEN CASE WHEN (SELECT count(*) FROM install_state) = 1 AND EXISTS (SELECT 1 FROM install_state WHERE installation_id = ? AND ownership_nonce = ?) THEN 1 ELSE 0 END
    ELSE CASE WHEN (SELECT count(*) FROM install_state) <= 1 THEN 1 ELSE 0 END END),
  'schema', json_object(${schema.join(', ')}),
  'tableTypesValid', CASE WHEN ${tableTypes.join(' AND ')} THEN 1 ELSE 0 END,
  'unsupportedTables', json((SELECT json_group_array(name) FROM (SELECT lower(name) AS name FROM sqlite_schema WHERE type IN ('table','view') AND lower(name) IN ('access_control_state','team_members','repository_team_grants','namespace_claims') ORDER BY name LIMIT 5))),
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
  format: 1;
  marker: { count: number; valid: boolean };
  schema: Record<LegacyTable, string[]>;
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
  const data = object(value, [
    'format',
    'marker',
    'schema',
    'tableTypesValid',
    'unsupportedTables',
    'invalidFields',
    ...Object.keys(fields),
  ]);
  if (
    data.format !== 1 ||
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
