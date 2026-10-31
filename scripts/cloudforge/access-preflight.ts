// CloudForge fork (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
import { createHash } from 'node:crypto';
import {
  accessPreflightQuery,
  analyzeAccessSnapshot,
} from './access-preflight-data.ts';
import type { Cloudflare } from './cloudflare.ts';
import type { Io } from './collect.ts';

export type AccessPreflightOptions = {
  accountId: string;
  database: { uuid: string; name: string };
  installation?: { id: string; ownershipNonce: string };
};

/** Snapshot identity only: this digest never authorizes a later mutation. */
export function accessSnapshotDigest(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)])
      );
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** Only SELECT is available to this path; no lock, state file or mutation command is created. */
export async function accessPreflight(
  ctx: { cf: Pick<Cloudflare, 'queryD1'>; io: Pick<Io, 'print'> },
  opts: AccessPreflightOptions
): Promise<number> {
  try {
    const query = accessPreflightQuery(opts.installation);
    const rows = await ctx.cf.queryD1(
      opts.accountId,
      opts.database.uuid,
      query.sql,
      query.params
    );
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      rows[0] === null ||
      typeof rows[0] !== 'object' ||
      !Object.hasOwn(rows[0], 'snapshot')
    )
      throw new Error('Invalid snapshot response');
    const analysis = analyzeAccessSnapshot(rows[0].snapshot);
    const target = {
      accountId: opts.accountId,
      databaseId: opts.database.uuid,
      installationId: opts.installation?.id ?? null,
    };
    const report = {
      ...analysis.report,
      command: 'access-preflight',
      reportVersion: 1,
      target,
      snapshotDigest: accessSnapshotDigest({
        target,
        snapshot: analysis.snapshot,
      }),
      blocked: analysis.blocked,
      rolePublishingAllowed: false,
      migrationApplied: false,
      notice:
        'Read-only observation. The snapshot digest is not an apply authorization or a guarantee of current state. No migration, deployment or rollback barrier was applied.',
    };
    ctx.io.print(JSON.stringify(report, null, 2));
    return analysis.blocked ? 1 : 0;
  } catch {
    // Database/transport exceptions can contain SQL, parameters and ownership material.
    ctx.io.print(
      'Access preflight could not read a valid, bounded compatibility snapshot. Nothing was changed.'
    );
    return 1;
  }
}
