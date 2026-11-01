// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// `upgrade` (spec §6): moves an install to this package's version. Read-only up to the confirmed
// plan; then resources, config, migrations, deploy, durable-objects, markers and verify, each
// recorded as `upgrade:<to>:<step>` so `--resume` continues a failed upgrade from the first
// unrecorded step.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  desiredOf,
  look,
  onAccount,
  provision,
  resource,
  writeMarkers,
  type Ctx,
  type Optional,
} from './apply.ts';
import {
  applyMigrations,
  confirmR2Keys,
  deploy,
  doIdsComplete,
  existingSecretNames,
  generatedSecrets,
  missingOptional,
  partialOptional,
  OPTIONAL_ITEMS,
  optionalSecretNames,
  optionalSecrets,
  readDoNamespaceIds,
  renderConfig,
  resumeCommand,
  sameIds,
  verifyAt,
  writeConfig,
} from './apply-steps.ts';
import {
  configVars,
  planAdoptWorker,
  varChanges,
  varStops,
} from './adopt-worker.ts';
import { ConfigConflict, isGenerated, TUNABLE_VARS } from './config.ts';
import { readAccessPreflight } from './access-preflight.ts';
import { readAccessProtocol, type AccessProtocol } from './access-protocol.ts';
import type { Observed } from './observe.ts';
import { computePlan, type Action, type Plan } from './plan.ts';
import { dockerProblem } from './preflight.ts';
import {
  acquireLock,
  hasStep,
  readState,
  recordResource,
  recordStep,
  transition,
  validateUpgradeAccessOrigin,
  writeState,
  type InstallState,
} from './state.ts';
import { compareRunning, type Comparison } from './versions.ts';

export type UpgradePlan = {
  /** The install's slug. */
  name: string;
  from: string | null;
  to: string;
  comparison: Comparison;
  /** Pending migration file names, sorted. */
  migrations: string[];
  /** computePlan actions with action "create". */
  create: Action[];
  /** Generated secret names the worker lacks. */
  secrets: string[];
  /** Operator-typed secret names the worker lacks: never generated, never a stop. */
  missing: string[];
  /**
   * A credential the worker holds only half of (one R2 key): neither half is ever sent; the
   * operator deletes the stray one and runs the upgrade again.
   */
  problems: string[];
  /** Vars the deploy drops that the worker does not need (adopt's `varChanges` drops). */
  drops: string[];
  /** Bindings taken as proven without the API confirming them (an adopted Artifacts namespace). */
  unverified: string[];
  /** The generated config's hash differs from `deployedConfigHash`. */
  configChanged: boolean;
  /** Observed schema and exact target migration contract; never a runtime/rollback barrier. */
  access: {
    schema: 'empty' | 'legacy' | 'compat-v1' | 'runtime-bridge-v1';
    protocol: AccessProtocol;
  };
  /** First 12 hex of sha256 over the plan lines. */
  digest: string;
};

export const IRREVERSIBLE_LINE =
  'Migrations cannot be undone. If the new release is broken, the way back is the next release.';

/** What `/.well-known/cloudforge` reports, compared with this package. */
type Running = {
  installationId: string | null;
  version: string | null;
  comparison: Comparison;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Adopted and not upgraded since: the running code may predate the installation id. */
const firstAfterAdopt = (s: InstallState) =>
  Boolean(s.adoptedAt) && !s.upgradedAt;

async function inspect(
  ctx: Ctx,
  s: InstallState,
  to: string
): Promise<Running> {
  const url = `${s.baseUrl}/.well-known/cloudforge`;
  let installationId: string | null = null;
  let version: string | null = null;
  let res: Response;
  try {
    res = await ctx.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new Error(
      `Could not read ${url} (${message(e)}). Nothing was changed.`
    );
  }
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as {
      installationId?: unknown;
      version?: unknown;
    } | null;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    installationId = str(body?.installationId);
    version = str(body?.version);
  } else if (!(res.status === 404 && firstAfterAdopt(s))) {
    throw new Error(`${url} answered HTTP ${res.status}. Nothing was changed.`);
  }
  const comparison = compareRunning(version, {
    version: to,
    commit: ctx.source.commit ?? '',
    history: ctx.source.history,
  });
  return { installationId, version, comparison };
}

/**
 * Migration files in the package that the install's D1 has not applied. No `d1_migrations` table
 * on an empty database: all. No such table beside other tables (a database set up without
 * `wrangler d1 migrations apply`) stops: applying everything would fail on the existing tables.
 * Applied migrations the package does not ship stop too: the database is ahead of this release
 * (checked whatever the running version, so --replace-custom-code never deploys older code over it).
 */
async function pendingMigrations(
  ctx: Ctx,
  s: InstallState,
  to: string
): Promise<string[]> {
  const files = readdirSync(ctx.source.migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const d1 = s.resources.find((r) => r.key === 'd1');
  if (!d1) return files;
  let applied: string[];
  try {
    const rows = await ctx.cf.queryD1(
      s.accountId,
      d1.id,
      'SELECT name FROM d1_migrations'
    );
    applied = rows.map((r) => String(r.name));
  } catch (e) {
    if (!/no such table/i.test(message(e))) throw e;
    const tables = await ctx.cf.queryD1(
      s.accountId,
      d1.id,
      // D1's own tables (_cf_*) and SQLite's (sqlite_*) do not count.
      "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_'"
    );
    if (tables.length === 0) return files;
    throw new Error(
      `D1 ${d1.name} has tables but no d1_migrations table; CloudForge cannot tell which migrations ran. ` +
        'Record the migrations that already ran in a d1_migrations table (as `wrangler d1 migrations apply` does), then run the upgrade again. Nothing was changed.'
    );
  }
  const ahead = applied.filter((n) => !files.includes(n)).sort();
  if (ahead.length > 0) {
    throw new Error(
      `The database has migrations this release does not ship (${ahead.join(', ')}): it is ahead of ${to}. Upgrade to a newer release instead. Nothing was changed.`
    );
  }
  return files.filter((f) => !applied.includes(f));
}

/** One line per credential the worker holds only half of. */
const halfSet = (ctx: Ctx, s: InstallState, have: string[]): string[] =>
  partialOptional(have).flatMap(({ present, absent }) =>
    present.map(
      (n) =>
        `Problem: the worker has ${n} without ${absent.join(', ')}, so the R2 upload keys are left as they are. ` +
        `Delete it (${ctx.source.wranglerCommand(`secret delete ${n} --name ${s.names.worker}`)}), then run the upgrade again to add a matching pair.`
    )
  );

function planLines(p: Omit<UpgradePlan, 'digest'>): string[] {
  const list = (xs: string[]) => (xs.length > 0 ? xs.join(', ') : 'none');
  const from = p.from ?? 'unknown';
  const lines = [`Upgrade ${p.name}: ${from} → ${p.to}`];
  if (p.comparison.kind === 'custom') {
    lines.push(
      `Replacing custom code: ${from} (${p.comparison.reason}) → CloudForge ${p.to}`
    );
  }
  lines.push(
    `Migrations: ${list(p.migrations)}`,
    `Access schema: ${p.access.schema} → ${p.access.protocol.targetSchema} (${p.access.protocol.migration.sha256})`,
    `Migration set: ${p.access.protocol.migrationSetSha256}`,
    `Create: ${list(p.create.map((a) => `${a.kind} ${a.name}`))}`,
    `New secrets: ${list(p.secrets)}`
  );
  if (p.missing.length > 0)
    lines.push(`Missing (you add them): ${p.missing.join(', ')}`);
  lines.push(...p.problems);
  if (p.drops.length > 0)
    lines.push('Drops these vars (the worker does not need them):', ...p.drops);
  lines.push(...p.unverified);
  lines.push(
    `Config: ${p.configChanged ? 'changes' : 'unchanged'}`,
    '',
    IRREVERSIBLE_LINE
  );
  return lines;
}

export function formatUpgradePlan(p: UpgradePlan): string {
  return planLines(p).join('\n');
}

type Planned = {
  plan: UpgradePlan;
  base: Plan;
  obs: Observed;
  /** Secret names the worker has. */
  have: string[];
};

/**
 * The worker's vars against the config this upgrade deploys (wrangler deploy replaces them all), as
 * adopt checks them: a var edited on the dashboard since adopt or the last upgrade stops. Tunable
 * vars are compared when kept (`inputs.vars`), and all of them on the first upgrade after adopt,
 * which recorded them as found; otherwise a release may change their template default.
 */
function varDrift(
  s: InstallState,
  obs: Observed,
  configText: string
): string[] {
  const current = obs.worker.vars;
  if (!current) return [];
  const compare = new Set(
    firstAfterAdopt(s) ? TUNABLE_VARS : Object.keys(s.inputs.vars ?? {})
  );
  const { stops, drops } = varChanges(
    current,
    configVars(configText),
    undefined,
    compare
  );
  if (stops.length > 0)
    throw varStops(
      s.names.worker,
      stops,
      'the upgrade',
      'run the upgrade again'
    );
  return drops;
}

/** Fail closed on unsupported ACL state; every call is read-only and is not a cloud lock. */
async function checkAccess(
  ctx: Ctx,
  s: InstallState,
  migrations: string[],
  expected?: UpgradePlan['access'],
  requireTarget = false
): Promise<UpgradePlan['access']> {
  validateUpgradeAccessOrigin(s);
  const protocol = readAccessProtocol(ctx.source);
  if (
    expected &&
    JSON.stringify(protocol) !== JSON.stringify(expected.protocol)
  )
    throw new Error(
      'The target access protocol changed after planning. Review the package again.'
    );
  const recorded = s.resources.find((r) => r.key === 'd1');
  const databases = await ctx.cf.listD1(s.accountId);
  const live = recorded
    ? databases.find(
        (db) => db.uuid === recorded.id && db.name === recorded.name
      )
    : databases.find((db) => db.name === s.names.d1);
  if (recorded && !live)
    throw new Error(
      'The recorded database is missing or renamed. Upgrade stopped.'
    );
  const d1 = live ? { id: live.uuid, name: live.name } : undefined;
  let schema: UpgradePlan['access']['schema'] = 'empty';
  if (d1) {
    // Empty is only an upgrade recovery state. An absent compatibility table beside any
    // application table is unsupported, not an empty database.
    const rows = await ctx.cf.queryD1(
      s.accountId,
      d1.id,
      "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE type IN ('table','view') AND substr(name,1,7) <> 'sqlite_' AND substr(name,1,4) <> '_cf_' AND name <> 'd1_migrations') THEN 0 ELSE 1 END AS access_empty"
    );
    if (
      rows.length !== 1 ||
      (rows[0]?.access_empty !== 0 && rows[0]?.access_empty !== 1)
    )
      throw new Error(
        'Access compatibility could not be verified. Upgrade stopped.'
      );
    if (rows[0].access_empty === 0) {
      const analysis = await readAccessPreflight(
        { cf: ctx.cf },
        {
          accountId: s.accountId,
          database: { uuid: d1.id, name: d1.name },
          installation: {
            id: s.installationId,
            ownershipNonce: s.ownershipNonce,
            allowMissing:
              !hasStep(s, `upgrade:${s.upgradeTarget}:markers`) &&
              (firstAfterAdopt(s) ||
                (s.upgradeAccessOrigin?.target === s.upgradeTarget &&
                  s.upgradeAccessOrigin?.databaseId === d1.id &&
                  s.resources.some(
                    (r) =>
                      r.key === 'd1' &&
                      r.id === d1.id &&
                      r.ownership === 'created'
                  ))),
          },
        }
      );
      if (analysis.blocked)
        throw new Error(
          'Access compatibility has blocking findings. Run access-preflight and resolve them before upgrading.'
        );
      schema = analysis.report.schemaVersion;
    }
  }
  if (schema === 'empty' && !migrations.includes(protocol.migration.name))
    throw new Error(
      'The empty database has incompatible migration receipts. Upgrade stopped.'
    );
  if (schema !== 'empty' && !protocol.acceptedSchemas.includes(schema))
    throw new Error(
      'The target package does not support the current access schema. Upgrade stopped.'
    );
  if (
    (schema === 'runtime-bridge-v1') ===
      migrations.includes(protocol.migration.name) ||
    (schema !== 'legacy' && schema !== 'empty') ===
      migrations.includes('0063_rare_skin.sql')
  )
    throw new Error(
      'Access schema and migration receipts disagree. Upgrade stopped.'
    );
  if (requireTarget && schema !== protocol.targetSchema)
    throw new Error(
      'Access migration did not establish the target schema. Deployment stopped.'
    );
  // A local completed-step receipt cannot override the live database journal.
  // This also protects resumed upgrades and the final marker/verification path.
  if (requireTarget && migrations.length > 0)
    throw new Error(
      'Pending database migrations remain. Deployment stopped; reconcile the database migration receipts before resuming.'
    );
  if (expected && !requireTarget && expected.schema !== schema)
    throw new Error(
      'The access schema changed after planning. Review the upgrade again.'
    );
  return { schema, protocol };
}

async function planned(
  ctx: Ctx,
  s: InstallState,
  running: Running,
  to: string,
  observation?: Observed
): Promise<Planned> {
  const migrations = await pendingMigrations(ctx, s, to);
  const access = await checkAccess(ctx, s, migrations);
  const obs = observation ?? (await look(ctx, s));
  const base = computePlan(desiredOf(s), obs, s);
  const config = renderConfig(ctx, s, to);
  const drops = varDrift(s, obs, config.text);
  const workerIsNew =
    base.actions.find((a) => a.key === 'worker')?.action === 'create';
  const have = await existingSecretNames(ctx, s.names.worker, workerIsNew);
  const p: Omit<UpgradePlan, 'digest'> = {
    name: s.inputs.name,
    from: running.version,
    to,
    comparison: running.comparison,
    migrations,
    access,
    create: base.actions.filter((a) => a.action === 'create'),
    secrets: Object.keys(generatedSecrets(have)),
    // Names only: what the operator types later is never part of the plan or its digest.
    missing: optionalSecretNames(missingOptional(have)),
    problems: halfSet(ctx, s, have),
    drops,
    unverified:
      obs.artifactsUnverified !== undefined
        ? [`artifacts ${s.names.artifacts}: bound, not verified`]
        : [],
    configChanged: config.hash !== s.deployedConfigHash,
  };
  const digest = createHash('sha256')
    .update(planLines(p).join('\n'))
    .digest('hex')
    .slice(0, 12);
  return { plan: { ...p, digest }, base, obs, have };
}

/** The upgrade plan for `s` against what runs and what Cloudflare holds now. Read-only. */
export async function planUpgrade(
  ctx: Ctx,
  s: InstallState
): Promise<UpgradePlan> {
  const to = await ctx.source.version(ctx.runner);
  return (await planned(ctx, s, await inspect(ctx, s, to), to)).plan;
}

/** Stops before anything is planned: wrong install, downgrade, custom code. */
function checkRunning(
  ctx: Ctx,
  s: InstallState,
  r: Running,
  to: string,
  replaceCustomCode: boolean
): void {
  const url = `${s.baseUrl}/.well-known/cloudforge`;
  const sameId =
    r.installationId === s.installationId ||
    (r.installationId === null && firstAfterAdopt(s));
  if (!sameId) {
    throw new Error(
      `${url} reports installation ${r.installationId ?? '(none)'}, not ${s.installationId}: this is not the install the state describes. Nothing was changed.`
    );
  }
  const running = r.version ?? 'unknown';
  if (r.comparison.kind === 'downgrade') {
    throw new Error(
      `${s.baseUrl} runs ${running}, newer than this package (${to}); upgrade never downgrades. Run that version instead: npx @cybernova2333/cloudforge@${running} upgrade --name ${s.inputs.name}. Nothing was changed.`
    );
  }
  if (r.comparison.kind === 'custom' && !replaceCustomCode) {
    throw new Error(
      `${s.baseUrl} runs code that is not a release (${running}: ${r.comparison.reason}). ` +
        `Upgrading would replace it with stock CloudForge ${to}; forks keep deploying from their own checkout. ` +
        `To replace it anyway: ${ctx.source.command(`upgrade --name ${s.inputs.name} --replace-custom-code`)}. Nothing was changed.`
    );
  }
}

/**
 * An interrupted upgrade is not permission to overwrite a deployment made since.
 * Settings provide current control-plane evidence even while the site is down;
 * a successful HTTP observation must agree. This is not a global rollout/CAS proof.
 */
async function inspectResume(
  ctx: Ctx,
  s: InstallState,
  to: string,
  replaceCustomCode: boolean,
  obs: Observed
): Promise<Running> {
  const vars = obs.worker.vars;
  const deployed = hasStep(s, `upgrade:${to}:deploy`);
  const unmarkedAdoption =
    firstAfterAdopt(s) &&
    !deployed &&
    !vars?.CLOUDFORGE_INSTALLATION &&
    s.resources.some((r) => r.key === 'worker' && r.ownership === 'adopted');
  let marker: { installationId?: unknown; ownershipNonce?: unknown } | null =
    null;
  try {
    marker = JSON.parse(vars?.CLOUDFORGE_INSTALLATION ?? 'null');
  } catch {
    // A malformed or missing ownership marker is never replaced by local state.
  }
  if (
    !obs.worker.exists ||
    (!unmarkedAdoption &&
      (!marker ||
        marker.installationId !== s.installationId ||
        marker.ownershipNonce !== s.ownershipNonce))
  )
    throw new Error(
      'Cloudflare worker settings do not confirm this installation. Resume stopped; nothing was changed.'
    );
  const version = vars?.CLOUDFORGE_VERSION;
  if (typeof version !== 'string' || !version.trim() || version.length > 128)
    throw new Error(
      'Cloudflare worker settings do not report a known version. Resume stopped; nothing was changed.'
    );
  const running: Running = {
    installationId: unmarkedAdoption ? null : s.installationId,
    version,
    comparison: compareRunning(version, {
      version: to,
      commit: ctx.source.commit ?? '',
      history: ctx.source.history,
    }),
  };
  // Custom-code replacement must be explicitly authorized for this invocation.
  checkRunning(ctx, s, running, to, replaceCustomCode);
  if (deployed && version !== to)
    throw new Error(
      'The completed deployment no longer matches the upgrade target. Resume stopped; start a new reviewed upgrade for the current code. Nothing was changed.'
    );
  if (
    version !== s.deployedVersion &&
    version !== to &&
    running.comparison.kind !== 'custom'
  )
    throw new Error(
      'The remote Worker version changed since this upgrade started. Resume stopped; review the current deployment before upgrading. Nothing was changed.'
    );
  let online: Running;
  try {
    online = await inspect(ctx, s, to);
  } catch {
    if (unmarkedAdoption)
      throw new Error(
        'The first adopted upgrade has no installation marker and the site cannot confirm its source version. Restore site access and retry --resume. Nothing was changed.'
      );
    ctx.io.print(
      'The site version probe is unavailable; resume uses the verified Cloudflare worker settings.'
    );
    return running;
  }
  checkRunning(ctx, s, online, to, replaceCustomCode);
  if (
    online.installationId !== running.installationId ||
    online.version !== running.version
  )
    throw new Error(
      'The site and Cloudflare worker settings disagree about the installation or version. Resume stopped; nothing was changed.'
    );
  if (unmarkedAdoption) {
    // Reuse adopt's current binding/namespace/config checks. Its generated nonce
    // is discarded: no ownership marker is inferred or written by this check.
    const verified = (
      await planAdoptWorker(ctx, {
        accountId: s.accountId,
        worker: s.names.worker,
      })
    ).state;
    const sameResource = (r: InstallState['resources'][number]) =>
      s.resources.some(
        (saved) =>
          saved.key === r.key &&
          saved.kind === r.kind &&
          saved.id === r.id &&
          saved.name === r.name
      );
    if (
      verified.baseUrl !== s.baseUrl ||
      verified.deployedVersion !== version ||
      Object.entries(s.names).some(
        ([key, name]) => verified.names[key as keyof typeof s.names] !== name
      ) ||
      !verified.resources.every(sameResource) ||
      s.resources
        .filter((r) => r.ownership === 'adopted')
        .some(
          (r) =>
            !verified.resources.some(
              (live) =>
                live.key === r.key && live.id === r.id && live.name === r.name
            )
        ) ||
      Object.entries(s.doNamespaceIds).some(
        ([key, id]) => id && verified.doNamespaceIds[key] !== id
      )
    )
      throw new Error(
        'The adopted Worker bindings, URL or source version changed. Restore the reviewed adoption configuration before retrying --resume. Nothing was changed.'
      );
  }
  return running;
}

/** `o` limited to the optional items `ids` (the ones the worker lacks). */
const onlyMissing = (o: Optional, ids: string[]): Optional => ({
  ...(o.r2 && ids.includes('r2-keys') ? { r2: o.r2 } : {}),
  ...(o.analytics && ids.includes('analytics-token')
    ? { analytics: o.analytics }
    : {}),
});

export async function upgrade(
  outer: Ctx,
  opts: {
    state: InstallState;
    yes: boolean;
    expectPlan?: string;
    replaceCustomCode: boolean;
    resume: boolean;
    /** Only print the plan and the apply command: no lock, nothing written. */
    plan?: boolean;
    /**
     * The operator-typed credentials (`OPTIONAL_ITEMS` ids) the worker lacks, as supplied now (env,
     * or a masked prompt in a terminal). Asked once the plan is confirmed, only while a deploy is
     * still to come; whatever is not supplied is deployed without and listed as missing.
     */
    askOptional?: (missing: string[]) => Promise<Optional>;
  }
): Promise<InstallState> {
  const ctx = onAccount(outer, opts.state);
  // Every deploy builds the runner image: no Docker, nothing planned, read or written.
  const docker = await dockerProblem(ctx.runner);
  if (docker)
    throw new Error(
      `Preflight found problems; nothing was changed.\n\n✗ ${docker}`
    );
  const slug = opts.state.inputs.name;
  const id = opts.state.installationId;
  const to = await ctx.source.version(ctx.runner);
  const resumeCmd = ctx.source.command(`upgrade --resume --name ${slug}`);
  const release = opts.plan ? () => {} : acquireLock(ctx.dir, id);
  let s = opts.state;
  const save = (next: InstallState) => {
    s = next;
    writeState(ctx.dir, s);
  };
  const prefix = `upgrade:${to}:`;
  let step = 'plan';
  let started = false;
  let problems: string[] = [];
  try {
    // Lock, then read the state as it is on disk now (inside the try: a corrupt state file must
    // not leak the lock).
    s = readState(ctx.dir, id) ?? opts.state;
    const unfinished =
      s.status === 'upgrading' ||
      (s.status === 'failed' && s.upgradeTarget !== undefined);
    if (unfinished) {
      if (s.upgradeTarget !== to) {
        throw new Error(
          `An upgrade to ${s.upgradeTarget} is unfinished; run npx @cybernova2333/cloudforge@${s.upgradeTarget} upgrade --resume --name ${slug}.`
        );
      }
      if (!opts.resume && !opts.plan) {
        throw new Error(`An upgrade to ${to} is unfinished; run ${resumeCmd}.`);
      }
    } else if (s.status !== 'installed') {
      throw new Error(
        `${slug} is not installed yet (status ${s.status}). Finish the install first: ${resumeCommand(s, ctx.source)}`
      );
    }
    const configFile = join(ctx.configDir, 'wrangler.jsonc');
    if (
      existsSync(configFile) &&
      !isGenerated(readFileSync(configFile, 'utf8'))
    )
      throw new ConfigConflict(configFile);

    let running: Running;
    let resumeObservation: Observed | undefined;
    let planningState = s;
    if (unfinished) {
      resumeObservation = await look(ctx, s);
      running = await inspectResume(
        ctx,
        s,
        to,
        opts.replaceCustomCode,
        resumeObservation
      );
      if (
        hasStep(s, `${prefix}deploy`) &&
        !hasStep(s, `${prefix}durable-objects`) &&
        !doIdsComplete(s.doNamespaceIds)
      ) {
        const ids = await readDoNamespaceIds(ctx, s);
        if (
          Object.entries(s.doNamespaceIds).some(
            ([key, id]) => id && ids[key] !== id
          )
        )
          throw new Error(
            'Recorded Durable Object namespaces changed. Resume stopped; nothing was changed.'
          );
        // A second deploy may have succeeded before its receipt was saved. Only
        // control-plane namespace IDs may explain the now-filled remote vars.
        planningState = { ...s, doNamespaceIds: ids };
      }
    } else {
      running = await inspect(ctx, s, to);
      checkRunning(ctx, s, running, to, opts.replaceCustomCode);
    }
    const { plan, base, obs, have } = await planned(
      ctx,
      planningState,
      running,
      to,
      resumeObservation
    );
    problems = plan.problems;
    ctx.io.print(formatUpgradePlan(plan));
    if (obs.artifactsUnverified !== undefined)
      ctx.io.print(
        `\nNote: the Artifacts namespace ${s.names.artifacts} could not be confirmed (${obs.artifactsUnverified}); its binding on ${s.names.worker} is taken as the proof.`
      );
    if (opts.plan) {
      const args = [
        'upgrade',
        ...(unfinished ? ['--resume'] : []),
        `--name ${slug}`,
        ...(plan.comparison.kind === 'custom' ? ['--replace-custom-code'] : []),
        `--expect-plan ${plan.digest}`,
        '--yes',
      ];
      ctx.io.print(`\nPlan ${plan.digest}\n\nTo apply it:`);
      ctx.io.print(ctx.source.command(args.join(' ')));
      return s;
    }
    if (opts.expectPlan !== undefined && opts.expectPlan !== plan.digest) {
      throw new Error(
        `The plan changed since it was reviewed (expected ${opts.expectPlan}, now ${plan.digest}). Review it again with --plan. Nothing was changed.`
      );
    }
    if (!opts.yes && !(await ctx.io.confirm('Apply this upgrade?', true))) {
      throw new Error('Nothing was changed.');
    }

    // A fresh upgrade to a version upgraded to before (a same-version redeploy) runs every step.
    const { upgradeAccessOrigin: _previousOrigin, ...fresh } = s;
    const from = unfinished
      ? s
      : { ...fresh, steps: s.steps.filter((x) => !x.key.startsWith(prefix)) };
    // Secrets and config whenever the deploy is still to come (judged after that reset).
    const deployPending = !hasStep(from, `${prefix}deploy`);
    const absent = missingOptional(have);
    let typed: Optional = {};
    if (deployPending && absent.length > 0 && opts.askOptional) {
      typed = onlyMissing(await opts.askOptional(absent), absent);
    }
    // Confirmation and optional credential prompts may have taken arbitrarily long.
    await checkAccess(ctx, s, await pendingMigrations(ctx, s, to), plan.access);
    save({ ...transition(from, 'upgrading'), upgradeTarget: to });
    started = true;
    const once = async (name: string, fn: () => Promise<void>) => {
      const key = `${prefix}${name}`;
      if (hasStep(s, key)) return;
      step = key;
      await fn();
      save(recordStep(s, key));
    };

    await once('resources', () =>
      provision(ctx, base, obs, {
        get: () => s,
        save,
        setStep: (k) => (step = k),
      })
    );

    const secrets: Record<string, string> = {};
    let hash = s.deployedConfigHash;
    if (deployPending) {
      // Typed R2 keys are checked against the LFS bucket (there now); rejected ones are skipped.
      if (typed.r2) {
        step = 'r2-keys';
        try {
          typed = { ...typed, r2: await confirmR2Keys(ctx, s, typed.r2) };
        } catch (e) {
          ctx.io.print(`${message(e)} The R2 upload keys were skipped.`);
          const { r2: _dropped, ...rest } = typed;
          typed = rest;
        }
      }
      step = `${prefix}config`;
      const generated = generatedSecrets(have);
      for (const n of plan.secrets) {
        const v = generated[n];
        if (v !== undefined) secrets[n] = v;
      }
      Object.assign(secrets, optionalSecrets(typed));
      // Never a name the worker has: an existing secret is never replaced.
      for (const n of have) delete secrets[n];
      hash = writeConfig(ctx, s, to);
      save(recordStep(s, step));
    }

    await once('migrations', async () => {
      await checkAccess(
        ctx,
        s,
        await pendingMigrations(ctx, s, to),
        plan.access
      );
      if (plan.access.schema === 'empty' && !s.upgradeAccessOrigin) {
        const database = s.resources.find((r) => r.key === 'd1');
        if (!database || database.ownership !== 'created')
          throw new Error(
            'Empty database recovery requires the recorded created database. Upgrade stopped.'
          );
        save({
          ...s,
          upgradeAccessOrigin: {
            target: to,
            databaseId: database.id,
            schema: 'empty',
          },
        });
      }
      await applyMigrations(ctx);
    });
    await once('deploy', async () => {
      await checkAccess(
        ctx,
        s,
        await pendingMigrations(ctx, s, to),
        plan.access,
        true
      );
      await deploy(ctx, secrets);
      s = {
        ...s,
        deployedConfigHash: hash,
        deployedVersion: to,
        skipped: OPTIONAL_ITEMS.filter(
          (i) => absent.includes(i.id) && !i.has(typed)
        ).map((i) => i.id),
      };
      for (const key of [
        'worker',
        'actionsWorkflow',
        'mergeWorkflow',
      ] as const) {
        const kind = key === 'worker' ? 'worker' : 'workflow';
        if (!s.resources.some((r) => r.key === key))
          s = recordResource(
            s,
            resource(key, kind, s.names[key], s.names[key])
          );
      }
    });
    // As install: the namespace ids go into vars, read (and deployed once more) only when one is missing.
    await once('durable-objects', async () => {
      if (doIdsComplete(s.doNamespaceIds)) return;
      const ids = await readDoNamespaceIds(ctx, s);
      if (!sameIds(ids, s.doNamespaceIds)) {
        const h = writeConfig(ctx, s, to, ids);
        await checkAccess(
          ctx,
          s,
          await pendingMigrations(ctx, s, to),
          plan.access,
          true
        );
        await deploy(ctx, {});
        s = { ...s, deployedConfigHash: h };
      }
      s = { ...s, doNamespaceIds: ids };
    });
    await checkAccess(
      ctx,
      s,
      await pendingMigrations(ctx, s, to),
      plan.access,
      true
    );
    await once('markers', () => writeMarkers(ctx, s, to));
    await once('verify', async () => {
      await verifyAt(ctx, s, to, resumeCmd);
    });

    const {
      upgradeTarget: _done,
      upgradeAccessOrigin: _origin,
      ...rest
    } = transition(s, 'installed');
    save({ ...rest, upgradedAt: ctx.now().toISOString() });
  } catch (e) {
    if (!started) throw e;
    if (s.status === 'upgrading') s = transition(s, 'failed');
    writeState(ctx.dir, s);
    throw new Error(
      `${message(e)}\n\nStep ${step} failed. Nothing after it ran. Run: ${resumeCmd}`,
      { cause: e }
    );
  } finally {
    release();
  }
  ctx.io.print(`Upgraded ${slug} to ${to}: ${s.baseUrl}`);
  for (const line of problems) ctx.io.print(line);
  const missing = optionalSecretNames(s.skipped);
  if (missing.length > 0) {
    ctx.io.print(
      `Missing (you add them): ${missing.join(', ')}. Add them with: ${resumeCommand(s, ctx.source)}`
    );
  }
  return s;
}
