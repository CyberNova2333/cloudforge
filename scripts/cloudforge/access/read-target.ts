// CloudForge fork (2026-11-05). SPDX-License-Identifier: GPL-3.0-or-later.
import type { AccessPreflightOptions } from './access-preflight.ts';
import { listInstalls } from '../installation/home.ts';
import { listStates } from '../installation/state.ts';
import { validateName } from '../planning/names.ts';
import type { Cloudflare } from '../platform/cloudflare.ts';

export type AccessReadFlags = {
  name?: string;
  database?: string;
  account?: string;
};

type ReadCloudflare = Pick<Cloudflare, 'listAccounts' | 'listD1' | 'queryD1'>;

const valid = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 256 &&
  !/[\p{Cc}\p{Cf}]/u.test(value);

/** Reject ambiguous or implicit targets before reading credentials or local state. */
export function validAccessReadFlags(f: AccessReadFlags): boolean {
  return !(
    (f.name === undefined) === (f.database === undefined) ||
    (f.name !== undefined &&
      (f.account !== undefined || !valid(f.name) || validateName(f.name))) ||
    (f.database !== undefined && (!valid(f.database) || !valid(f.account)))
  );
}

export type AccessReadTarget =
  | { ok: true; cf: ReadCloudflare; options: AccessPreflightOptions }
  | {
      ok: false;
      reason: 'missing-record' | 'moved-record' | 'unverifiable';
    };

/** Only local records and cloud inventories are read. No state, lock or resource is written. */
export async function resolveAccessReadTarget(
  f: AccessReadFlags,
  deps: {
    home: string | null;
    dir: string;
    cloudflare(): Promise<ReadCloudflare>;
  }
): Promise<AccessReadTarget> {
  try {
    if (!validAccessReadFlags(f)) return { ok: false, reason: 'unverifiable' };
    const records =
      f.name === undefined
        ? []
        : deps.home !== null
          ? listInstalls(deps.home)
              .filter((record) => record.slug === f.name)
              .map((record) => record.state)
          : listStates(deps.dir).filter(
              (state) => state.inputs.name === f.name
            );
    if (f.name !== undefined && records.length !== 1)
      return { ok: false, reason: 'missing-record' };
    const recorded = records[0];
    if (recorded?.movedTo !== undefined)
      return { ok: false, reason: 'moved-record' };
    const resources = recorded?.resources.filter((r) => r.kind === 'd1');
    if (
      recorded &&
      (!valid(recorded.accountId) ||
        !valid(recorded.installationId) ||
        !valid(recorded.ownershipNonce) ||
        resources?.length !== 1 ||
        !valid(resources[0]?.id))
    )
      return { ok: false, reason: 'unverifiable' };

    // Credential acquisition remains after local record validation.
    const cf = await deps.cloudflare();
    const accountSelector = recorded?.accountId ?? f.account!;
    const accounts = await cf.listAccounts();
    const matches = accounts.filter(
      (account) =>
        account.id === accountSelector ||
        (!recorded &&
          account.name.toLowerCase() === accountSelector.toLowerCase())
    );
    if (matches.length !== 1 || !valid(matches[0].id))
      return { ok: false, reason: 'unverifiable' };
    const accountId = matches[0].id;
    const databaseSelector = resources?.[0]?.id ?? f.database!;
    const databases = (await cf.listD1(accountId)).filter(
      (database) =>
        database.uuid === databaseSelector ||
        (!recorded && database.name === databaseSelector)
    );
    if (
      databases.length !== 1 ||
      !valid(databases[0].uuid) ||
      !valid(databases[0].name)
    )
      return { ok: false, reason: 'unverifiable' };
    return {
      ok: true,
      cf,
      options: {
        accountId,
        database: databases[0],
        ...(recorded
          ? {
              installation: {
                id: recorded.installationId,
                ownershipNonce: recorded.ownershipNonce,
              },
            }
          : {}),
      },
    };
  } catch {
    // Cloud errors can contain SQL, parameters or credentials; never return them.
    return { ok: false, reason: 'unverifiable' };
  }
}
