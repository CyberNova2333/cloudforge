// CloudForge fork addition (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import {
  accessPreflightQuery,
  analyzeAccessSnapshot,
  ACCESS_PREFLIGHT_MAX_BYTES,
  type AccessInstallation,
} from './access-preflight-data.ts';

export const ACCESS_DRAIN_LIMIT = 1000;
export const ACCESS_DRAIN_SAMPLE_LIMIT = 20;
const MAX_ID_BYTES = 512;
const MAX_INTEGER = Number.MAX_SAFE_INTEGER;

type Field = {
  column: string;
  kind: 'id' | 'integer';
  nullable?: boolean;
  scale?: number;
};
type Category = {
  table: string;
  columns: Record<string, string>;
  predicate: string;
  states: readonly string[];
  state: string;
  completion: string;
  fields: Record<string, Field>;
};
const id = (column: string, nullable = false): Field => ({
  column,
  kind: 'id',
  nullable,
});
const integer = (column: string, nullable = false, scale = 1): Field => ({
  column,
  kind: 'integer',
  nullable,
  scale,
});
const columns = (text: string, ints: string, real = '') =>
  Object.fromEntries([
    ...text
      .split(' ')
      .filter(Boolean)
      .map((name) => [name, 'TEXT']),
    ...ints
      .split(' ')
      .filter(Boolean)
      .map((name) => [name, 'INTEGER']),
    ...real
      .split(' ')
      .filter(Boolean)
      .map((name) => [name, 'REAL']),
  ]);

// This is a pinned observation contract, deliberately independent of future ORM changes.
// Samples read identifiers, states and times/counters. Agent error is compared only
// to the fixed recovery marker; no error or other payload is returned.
const categories = {
  workflowRuns: {
    table: 'workflow_runs',
    columns: columns(
      'id repository_id workflow_path name event event_data trigger_key ref head_sha display_title actor_id status conclusion error_message',
      'run_number created_at started_at completed_at'
    ),
    predicate: "status IS NOT 'completed' OR completed_at IS NULL",
    states: ['queued', 'in_progress'],
    state: 'status',
    completion: 'completed_at',
    fields: {
      id: id('id'),
      repositoryId: id('repository_id'),
      createdAt: integer('created_at', false, 1000),
      startedAt: integer('started_at', true, 1000),
      completedAt: integer('completed_at', true, 1000),
    },
  },
  workflowJobs: {
    table: 'workflow_jobs',
    columns: columns(
      'id run_id job_key name runs_on needs matrix_values status conclusion',
      'started_at completed_at'
    ),
    predicate: "status IS NOT 'completed' OR completed_at IS NULL",
    states: ['queued', 'in_progress'],
    state: 'status',
    completion: 'completed_at',
    fields: {
      id: id('id'),
      runId: id('run_id'),
      startedAt: integer('started_at', true, 1000),
      completedAt: integer('completed_at', true, 1000),
    },
  },
  runnerSessions: {
    table: 'runner_sessions',
    columns: columns(
      'id job_id repository_id instance_type',
      'started_at stopped_at deadline_at'
    ),
    predicate: 'stopped_at IS NULL',
    states: ['open'],
    state: "'open'",
    completion: 'stopped_at',
    fields: {
      id: id('id'),
      jobId: id('job_id', true),
      repositoryId: id('repository_id', true),
      startedAt: integer('started_at'),
      stoppedAt: integer('stopped_at', true),
      deadlineAt: integer('deadline_at'),
    },
  },
  agentRuns: {
    table: 'agent_runs',
    columns: columns(
      'id repository_id pull_request_id kind status title workflow_instance_id error',
      'started_at finished_at'
    ),
    predicate:
      "status NOT IN ('succeeded','failed') OR status IS NULL OR finished_at IS NULL OR (status = 'failed' AND error = 'Did not finish')",
    states: ['running'],
    state: 'status',
    completion: 'finished_at',
    fields: {
      id: id('id'),
      repositoryId: id('repository_id'),
      startedAt: integer('started_at'),
      finishedAt: integer('finished_at', true),
    },
  },
  agentSteps: {
    table: 'agent_steps',
    columns: columns(
      'id run_id name status model decision error',
      'position started_at finished_at attempts tokens_in tokens_out',
      'cost_estimate'
    ),
    predicate:
      "status NOT IN ('succeeded','failed') OR status IS NULL OR finished_at IS NULL OR (status = 'failed' AND error = 'Did not finish')",
    states: ['running'],
    state: 'status',
    completion: 'finished_at',
    fields: {
      id: id('id'),
      runId: id('run_id'),
      startedAt: integer('started_at', true),
      finishedAt: integer('finished_at', true),
      attempts: integer('attempts'),
    },
  },
  pushEvents: {
    table: 'push_events',
    columns: columns(
      'id repository_id actor_id commands',
      'attempts claimed_at created_at completed_at'
    ),
    predicate: 'completed_at IS NULL',
    states: ['pending'],
    state: "'pending'",
    completion: 'completed_at',
    fields: {
      id: id('id'),
      repositoryId: id('repository_id'),
      createdAt: integer('created_at'),
      claimedAt: integer('claimed_at', true),
      completedAt: integer('completed_at', true),
      attempts: integer('attempts'),
    },
  },
} satisfies Record<string, Category>;
export type AccessDrainCategory = keyof typeof categories;
export type AccessDrainSample = Record<string, string | number | null>;
export type AccessDrainCategoryObservation = {
  count: number;
  states: Record<string, number>;
  samples: AccessDrainSample[];
};

// GLOB ranges reject Cc/Cf characters throughout the bounded candidate set, including
// records outside the sample. NUL is checked separately (SQLite pattern terminator).
const controlRanges = [
  [1, 31],
  [127, 159],
  [0xad],
  [0x600, 0x605],
  [0x61c],
  [0x6dd],
  [0x70f],
  [0x890, 0x891],
  [0x8e2],
  [0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xfeff],
  [0xfff9, 0xfffb],
  [0x110bd],
  [0x110cd],
  [0x13430, 0x13455],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0001],
  [0xe0020, 0xe007f],
];
// D1 limits LIKE/GLOB patterns to 50 UTF-8 bytes, even when SQLite on Node accepts more.
const controlPatterns: string[] = [];
let controlGroup = '';
for (const [start, end] of controlRanges) {
  const range =
    String.fromCodePoint(start) +
    (end === undefined ? '' : '-' + String.fromCodePoint(end));
  if (new TextEncoder().encode(controlGroup + range).length > 46) {
    controlPatterns.push(`*[${controlGroup}]*`);
    controlGroup = '';
  }
  controlGroup += range;
}
if (controlGroup) controlPatterns.push(`*[${controlGroup}]*`);
const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;

function validField(field: Field) {
  const name = field.column;
  const valid =
    field.kind === 'id'
      ? `typeof(${name}) = 'text' AND length(CAST(${name} AS BLOB)) BETWEEN 1 AND ${MAX_ID_BYTES}
       AND instr(${name}, char(0)) = 0 AND NOT EXISTS (SELECT 1 FROM drain_control WHERE ${name} GLOB pattern)`
      : `typeof(${name}) = 'integer' AND ${name} BETWEEN 0 AND ${Math.floor(MAX_INTEGER / (field.scale ?? 1))}`;
  return field.nullable ? `(${name} IS NULL OR (${valid}))` : `(${valid})`;
}

/** One SELECT rechecks the complete bridge/ownership snapshot and all six projections. */
export function accessDrainQuery(installation?: AccessInstallation) {
  const access = accessPreflightQuery(installation, 'runtime-bridge-v1');
  const ctes: string[] = [
    `access_snapshot AS MATERIALIZED (${access.sql})`,
    `drain_control(pattern) AS (VALUES ${controlPatterns.map(() => '(?)').join(',')})`,
  ];
  const schemaChecks: string[] = [];
  const summaries: string[] = [];
  for (const [key, category] of Object.entries(categories)) {
    const fields: Record<string, Field> = category.fields;
    const states = category.states.map(quoted).join(',');
    const valid = [
      ...Object.values(fields).map(validField),
      `${category.state} IN (${states})`,
      // recordingSteps retains the preceding attempt's finish time on retry.
      // A running step remains a candidate even with that historical timestamp.
      key === 'agentSteps' ? '1' : `${category.completion} IS NULL`,
    ].join(' AND ');
    const sample = Object.entries(fields)
      .flatMap(([name, field]) => [
        quoted(name),
        field.kind === 'integer' && (field.scale ?? 1) !== 1
          ? `${field.column} * ${field.scale}`
          : field.column,
      ])
      .join(',');
    ctes.push(`${key} AS MATERIALIZED (
      SELECT id AS sort_id, CASE WHEN ${valid} THEN 0 ELSE 1 END AS invalid,
        CASE WHEN ${category.state} IN (${states}) THEN ${category.state} ELSE 'invalid' END AS state,
        CASE WHEN ${valid} THEN json_object(${sample}, 'state', ${category.state}) ELSE '{}' END AS sample
      FROM ${category.table} WHERE ${category.predicate}
      ORDER BY id LIMIT ${ACCESS_DRAIN_LIMIT + 1}
    )`);
    const expected = Object.entries(category.columns)
      .map(([name, type]) => quoted(`${name}:${type}:0`))
      .join(',');
    schemaChecks.push(`(
      (SELECT count(*) FROM sqlite_schema WHERE name = '${category.table}' AND type = 'table') = 1
      AND (SELECT count(*) FROM pragma_table_xinfo('${category.table}')) = ${Object.keys(category.columns).length}
      AND NOT EXISTS (SELECT 1 FROM pragma_table_xinfo('${category.table}')
        WHERE (name || ':' || upper(type) || ':' || hidden) NOT IN (${expected}))
    )`);
    const stateCounts = category.states
      .flatMap((state) => [
        quoted(state),
        `(SELECT count(*) FROM ${key} WHERE state = ${quoted(state)})`,
      ])
      .join(',');
    summaries.push(`${quoted(key)}, json_object(
      'count', (SELECT count(*) FROM ${key}),
      'invalid', (SELECT coalesce(sum(invalid),0) FROM ${key}),
      'states', json_object(${stateCounts}),
      'samples', json((SELECT json_group_array(json(sample)) FROM (SELECT sample FROM ${key} ORDER BY sort_id LIMIT ${ACCESS_DRAIN_SAMPLE_LIMIT})))
    )`);
  }
  ctes.push(`drain_snapshot AS MATERIALIZED (SELECT json_object(
    'format', 1, 'schemaValid', CASE WHEN ${schemaChecks.join(' AND ')} THEN 1 ELSE 0 END,
    'observedAt', CAST(unixepoch('subsecond') * 1000 AS INTEGER),
    'categories', json_object(${summaries.join(',')})
  ) AS snapshot)`);
  // Both values together stay below the preflight envelope budget. Per-field bounds
  // prevent oversized strings being aggregated before this final length check.
  return {
    sql: `WITH ${ctes.join(',\n')}
      SELECT CASE WHEN length(CAST(a.snapshot AS BLOB)) + length(CAST(d.snapshot AS BLOB)) <= ${ACCESS_PREFLIGHT_MAX_BYTES}
        THEN a.snapshot ELSE '{}' END AS accessSnapshot,
        CASE WHEN length(CAST(a.snapshot AS BLOB)) + length(CAST(d.snapshot AS BLOB)) <= ${ACCESS_PREFLIGHT_MAX_BYTES}
        THEN d.snapshot ELSE '{}' END AS drainSnapshot
      FROM access_snapshot a CROSS JOIN drain_snapshot d`,
    params: [...access.params, ...controlPatterns],
  };
}

function fail(): never {
  throw new Error('Invalid bounded drain observation');
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  )
    fail();
  return value as Record<string, unknown>;
}
function count(value: unknown, maximum = MAX_INTEGER): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    fail();
  return value;
}
function bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

/** Rebuild a narrow output; never return raw database rows or diagnostic exceptions. */
export function analyzeAccessDrainSnapshot(
  accessRaw: unknown,
  drainRaw: unknown
) {
  if (
    typeof accessRaw !== 'string' ||
    typeof drainRaw !== 'string' ||
    bytes(accessRaw) + bytes(drainRaw) > ACCESS_PREFLIGHT_MAX_BYTES
  )
    fail();
  const access = analyzeAccessSnapshot(accessRaw);
  if (
    access.blocked ||
    access.report.schemaVersion !== 'runtime-bridge-v1' ||
    access.report.runtime?.minimumProtocol !== 1
  )
    fail();
  const data = object(JSON.parse(drainRaw), [
    'format',
    'schemaValid',
    'observedAt',
    'categories',
  ]);
  if (data.format !== 1 || data.schemaValid !== 1) fail();
  const observedAt = count(data.observedAt);
  const rawCategories = object(data.categories, Object.keys(categories));
  const observations = {} as Record<
    AccessDrainCategory,
    AccessDrainCategoryObservation
  >;
  for (const [key, category] of Object.entries(categories)) {
    const row = object(rawCategories[key], [
      'count',
      'invalid',
      'states',
      'samples',
    ]);
    const total = count(row.count, ACCESS_DRAIN_LIMIT);
    if (row.invalid !== 0) fail();
    const rawStates = object(row.states, [...category.states]);
    const states = Object.fromEntries(
      Object.entries(rawStates).map(([state, n]) => [state, count(n, total)])
    );
    if (Object.values(states).reduce((sum, n) => sum + n, 0) !== total) fail();
    if (
      !Array.isArray(row.samples) ||
      row.samples.length !== Math.min(total, ACCESS_DRAIN_SAMPLE_LIMIT)
    )
      fail();
    const seen = new Set<string>();
    const fields: Record<string, Field> = category.fields;
    const samples = row.samples.map((raw): AccessDrainSample => {
      const sample = object(raw, [...Object.keys(fields), 'state']);
      if (
        typeof sample.state !== 'string' ||
        !Object.hasOwn(states, sample.state)
      )
        fail();
      const result: AccessDrainSample = { state: sample.state };
      for (const [name, field] of Object.entries(fields)) {
        const value = sample[name];
        if (value === null && field.nullable) result[name] = null;
        else if (field.kind === 'integer') result[name] = count(value);
        else {
          if (
            typeof value !== 'string' ||
            bytes(value) < 1 ||
            bytes(value) > MAX_ID_BYTES ||
            /[\p{Cc}\p{Cf}]/u.test(value)
          )
            fail();
          result[name] = value;
        }
        if (
          key !== 'agentSteps' &&
          field.column === category.completion &&
          value !== null
        )
          fail();
      }
      const sampleId = result.id as string;
      if (seen.has(sampleId)) fail();
      seen.add(sampleId);
      return result;
    });
    for (const [state, n] of Object.entries(states)) {
      if (samples.filter((sample) => sample.state === state).length > n) fail();
    }
    observations[key as AccessDrainCategory] = {
      count: total,
      states,
      samples,
    };
  }
  return {
    schemaVersion: 'runtime-bridge-v1' as const,
    accessGeneration: access.report.accessGeneration,
    runtime: access.report.runtime,
    observedAt,
    categories: observations,
    workflowJobCapacityReservations:
      observations.workflowJobs.states.in_progress,
    workObserved: Object.values(observations).some((entry) => entry.count > 0),
    observationsOnly: true as const,
    drainComplete: false as const,
    rolePublishingAllowed: false as const,
    rollbackSafe: false as const,
    admissionPaused: false as const,
  };
}
