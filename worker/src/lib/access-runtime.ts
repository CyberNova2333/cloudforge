// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
export const ACCESS_RUNTIME_PROTOCOL = 1;

export type AccessRuntimeStatus = {
  protocol: typeof ACCESS_RUNTIME_PROTOCOL;
  ready: boolean;
  minimumProtocol: number | null;
  schemaMode: 'compat-v1' | null;
  rolePublishingEnabled: false | null;
  revision: number | null;
  reason: 'ready' | 'missing' | 'unavailable' | 'invalid' | 'unsupported';
};

const unavailable = (
  reason: AccessRuntimeStatus['reason']
): AccessRuntimeStatus => ({
  protocol: ACCESS_RUNTIME_PROTOCOL,
  ready: false,
  minimumProtocol: null,
  schemaMode: null,
  rolePublishingEnabled: null,
  revision: null,
  reason,
});

const integer = (value: unknown, minimum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

/**
 * A fresh, bounded admission read; never cache this in an isolate or a durable Workflow step.
 * Raw D1 bindings query the primary even with read replication enabled. Do not substitute a
 * replica-backed D1 session: https://developers.cloudflare.com/d1/best-practices/read-replication/
 */
export async function readAccessRuntime(
  DB: D1Database
): Promise<AccessRuntimeStatus> {
  try {
    const { results, success } = await DB.prepare(
      'SELECT id, minimum_protocol, schema_mode, role_publishing_enabled, revision FROM access_runtime_state LIMIT 2'
    ).all<Record<string, unknown>>();
    if (!success) return unavailable('unavailable');
    if (!results.length) return unavailable('missing');
    const row = results[0];
    if (
      results.length !== 1 ||
      row.id !== 1 ||
      !integer(row.minimum_protocol, 1) ||
      !integer(row.revision, 0) ||
      row.schema_mode !== 'compat-v1' ||
      row.role_publishing_enabled !== 0
    )
      return unavailable('invalid');
    const ready = row.minimum_protocol <= ACCESS_RUNTIME_PROTOCOL;
    return {
      protocol: ACCESS_RUNTIME_PROTOCOL,
      ready,
      minimumProtocol: row.minimum_protocol,
      schemaMode: 'compat-v1',
      rolePublishingEnabled: false,
      revision: row.revision,
      reason: ready ? 'ready' : 'unsupported',
    };
  } catch {
    return unavailable('unavailable');
  }
}

export class AccessRuntimeError extends Error {
  constructor(public readonly status: AccessRuntimeStatus) {
    super('CloudForge runtime is unavailable for this access protocol.');
    this.name = 'AccessRuntimeError';
  }
}

export async function assertAccessRuntime(
  DB: D1Database
): Promise<AccessRuntimeStatus> {
  const status = await readAccessRuntime(DB);
  if (!status.ready) throw new AccessRuntimeError(status);
  return status;
}
