// CloudForge fork addition (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import {
  accessDrainQuery,
  analyzeAccessDrainSnapshot,
} from './access-drain-data.ts';
import {
  accessPreflightDiscoveryQuery,
  classifyAccessSchema,
} from './access-preflight-data.ts';
import {
  accessSnapshotDigest,
  type AccessPreflightOptions,
} from './access-preflight.ts';
import type { Cloudflare } from '../platform/cloudflare.ts';
import type { Io } from '../ui/collect.ts';

/** No lock, local state write, runtime update or task-control adapter is available. */
export async function accessDrainStatus(
  ctx: { cf: Pick<Cloudflare, 'queryD1'>; io: Pick<Io, 'print'> },
  opts: AccessPreflightOptions
): Promise<number> {
  try {
    const query = async (sql: string, params: (string | number)[]) => {
      const rows = await ctx.cf.queryD1(
        opts.accountId,
        opts.database.uuid,
        sql,
        params
      );
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        !rows[0] ||
        typeof rows[0] !== 'object'
      )
        throw new Error('Invalid observation');
      return rows[0];
    };
    const discovery = accessPreflightDiscoveryQuery();
    const discovered = await query(discovery.sql, discovery.params);
    if (
      classifyAccessSchema(discovered.schemaDiscovery) !== 'runtime-bridge-v1'
    )
      throw new Error('Unsupported observation schema');
    const request = accessDrainQuery(opts.installation);
    const row = await query(request.sql, request.params);
    const observation = analyzeAccessDrainSnapshot(
      row.accessSnapshot,
      row.drainSnapshot
    );
    const target = {
      accountId: opts.accountId,
      databaseId: opts.database.uuid,
      installationId: opts.installation?.id ?? null,
    };
    ctx.io.print(
      JSON.stringify(
        {
          command: 'access-drain-status',
          reportVersion: 1,
          target,
          ...observation,
          snapshotDigest: accessSnapshotDigest({ target, observation }),
          timeUnit: 'milliseconds',
          coverage: {
            scope: 'bounded unfinished records in six D1 tables',
            candidateLimitPerCategory: 1000,
            sampleLimitPerCategory: 20,
            unobserved: [
              'Cloudflare Workflow instance status and code versions',
              'Containers, Durable Object queues, storage and alarms',
              'Old deployments and requests already past admission',
              'Other task domains, recovery records, outboxes and external side effects',
            ],
          },
          notice:
            'Read-only observation, immediately subject to change. Exit 0 means a supported observation, including when work is present. Empty results do not prove draining or task termination. No admission pause, migration, deployment, role publication or rollback authorization was applied. The digest is descriptive only.',
        },
        null,
        2
      )
    );
    return 0;
  } catch {
    // Database/transport errors may contain SQL, parameters or ownership material.
    ctx.io.print(
      'Access drain status could not read a valid, bounded runtime-bridge snapshot. Nothing was changed.'
    );
    return 1;
  }
}
