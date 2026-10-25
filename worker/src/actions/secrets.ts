import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  actionsSecretRepositories,
  actionsVariables,
  type ActionsVariable,
} from '../db/app.schema';
import { inJsonArray } from '../lib/sql-set';
import type { DrizzleDB } from '../db/middleware';
import { maskValues } from './commands';

/**
 * Actions secrets and variables (`${{ secrets.X }}`, `${{ vars.X }}`): one `actions_variables` row each, per
 * repository or instance-wide (repository null; a repository's own row of the same kind and name wins). An
 * instance-wide secret reaches only the repositories a site admin listed for it (`actions_secret_repositories`): any
 * member can create a repository and run a workflow in it, so a secret for every repository would be one for every
 * member. Instance-wide variables reach every repository.
 *
 * A secret's value is stored as AES-256-GCM ciphertext under a key derived (HKDF-SHA-256) from the
 * ACTIONS_SECRETS_KEY Worker secret, with the row's scope and name as associated data so a ciphertext can't be
 * moved to another row. It is decrypted only while a job runs, outside any durable Workflow step (step results are
 * persisted), and every job log masks it. The API never returns it. Without ACTIONS_SECRETS_KEY, secrets can't be
 * saved and read as empty. Variables are plain text, readable by repository admins and in workflows.
 */

export type VariableKind = ActionsVariable['kind'];

/** GitHub's limits: 48 KB a value; 100 secrets and 500 variables a repository, 1000 of each instance-wide. */
export const MAX_VALUE_BYTES = 48 * 1024;
export const MAX_PER_SCOPE: Record<
  'repository' | 'instance',
  Record<VariableKind, number>
> = {
  repository: { secret: 100, variable: 500 },
  instance: { secret: 1000, variable: 1000 },
};

export function secretsConfigured(env: CloudflareBindings): boolean {
  const key = (env as Partial<CloudflareBindings>).ACTIONS_SECRETS_KEY;
  return typeof key === 'string' && key.length > 0;
}

/** Upper-cased, as stored. */
export const normalizeName = (name: string) => name.trim().toUpperCase();

/** GitHub's rules for secret and variable names; null when `name` (normalized) is fine. */
export function nameError(name: string): string | null {
  if (!name) return 'A name is required.';
  if (name.length > 100) return 'Names are at most 100 characters.';
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name))
    return 'Names may contain only letters, digits and underscores, and may not start with a digit.';
  if (/^(GITHUB|CLOUDFORGE)_/.test(name))
    return 'Names may not start with GITHUB_ or CLOUDFORGE_: those are reserved for the runner.';
  return null;
}

export function valueError(value: string): string | null {
  if (!value) return 'A value is required.';
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES)
    return 'Values are at most 48 KB.';
  return null;
}

// ── encryption ───────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function aesKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        'HKDF',
        false,
        ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: enc.encode('cloudforge-actions-secrets'),
          info: enc.encode('aes-256-gcm v1'),
        },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    })();
    keys.set(secret, k);
  }
  return k;
}

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** What binds a ciphertext to its row. */
const aad = (repositoryId: string | null, name: string) =>
  enc.encode(`${repositoryId ?? '*'}:${name}`);

export async function encryptSecret(
  env: CloudflareBindings,
  repositoryId: string | null,
  name: string,
  value: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(repositoryId, name) },
    await aesKey(env.ACTIONS_SECRETS_KEY),
    enc.encode(value)
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

/** Null when the stored value can't be decrypted (another key, or another row's ciphertext). */
export async function decryptSecret(
  env: CloudflareBindings,
  repositoryId: string | null,
  name: string,
  stored: string
): Promise<string | null> {
  const [v, iv, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !ct) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: unb64(iv),
        additionalData: aad(repositoryId, name),
      },
      await aesKey(env.ACTIONS_SECRETS_KEY),
      unb64(ct)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ── storage ──────────────────────────────────────────────────────────────────

const scopeIs = (repositoryId: string | null) =>
  repositoryId === null
    ? isNull(actionsVariables.repositoryId)
    : eq(actionsVariables.repositoryId, repositoryId);

/** The scope's rows of one kind, by name. */
export function listVariables(
  db: DrizzleDB,
  repositoryId: string | null,
  kind: VariableKind
): Promise<ActionsVariable[]> {
  return db
    .select()
    .from(actionsVariables)
    .where(and(scopeIs(repositoryId), eq(actionsVariables.kind, kind)))
    .orderBy(asc(actionsVariables.name))
    .all();
}

export class VariableError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409
  ) {
    super(message);
  }
}

/**
 * Creates or replaces a secret or variable. `name` must already be normalized and valid, `value` valid. Throws
 * VariableError when the scope is full or (for a secret) the server has no ACTIONS_SECRETS_KEY.
 */
export async function saveVariable(
  env: CloudflareBindings,
  db: DrizzleDB,
  o: {
    repositoryId: string | null;
    kind: VariableKind;
    name: string;
    value: string;
    userId: string;
  }
): Promise<{ created: boolean }> {
  if (o.kind === 'secret' && !secretsConfigured(env))
    throw new VariableError(
      "Secrets aren't set up on this server: it needs the ACTIONS_SECRETS_KEY secret.",
      400
    );
  const stored =
    o.kind === 'secret'
      ? await encryptSecret(env, o.repositoryId, o.name, o.value)
      : o.value;
  const now = new Date();
  const where = and(
    scopeIs(o.repositoryId),
    eq(actionsVariables.kind, o.kind),
    eq(actionsVariables.name, o.name)
  );
  const existing = await db
    .select({ id: actionsVariables.id })
    .from(actionsVariables)
    .where(where)
    .get();
  if (existing) {
    await db
      .update(actionsVariables)
      .set({ value: stored, updatedById: o.userId, updatedAt: now })
      .where(eq(actionsVariables.id, existing.id));
    return { created: false };
  }
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(actionsVariables)
    .where(and(scopeIs(o.repositoryId), eq(actionsVariables.kind, o.kind)))
    .get();
  const max =
    MAX_PER_SCOPE[o.repositoryId === null ? 'instance' : 'repository'][o.kind];
  if ((count?.n ?? 0) >= max)
    throw new VariableError(
      `This ${o.repositoryId === null ? 'instance' : 'repository'} already has ${max} ${o.kind}s, the most it can have.`,
      409
    );
  await db.insert(actionsVariables).values({
    id: crypto.randomUUID(),
    repositoryId: o.repositoryId,
    kind: o.kind,
    name: o.name,
    value: stored,
    updatedById: o.userId,
    createdAt: now,
    updatedAt: now,
  });
  return { created: true };
}

/** Whether there was one to delete. */
export async function deleteVariable(
  db: DrizzleDB,
  repositoryId: string | null,
  kind: VariableKind,
  name: string
): Promise<boolean> {
  const gone = await db
    .delete(actionsVariables)
    .where(
      and(
        scopeIs(repositoryId),
        eq(actionsVariables.kind, kind),
        eq(actionsVariables.name, name)
      )
    )
    .returning({ id: actionsVariables.id });
  return gone.length > 0;
}

// ── jobs ─────────────────────────────────────────────────────────────────────

export interface JobValues {
  /** `secrets` context: instance-wide, then the repository's own. */
  secrets: Record<string, string>;
  /** `vars` context, likewise. */
  vars: Record<string, string>;
  /** Shown in "Set up job": secrets that read as empty, and why. */
  notes: string[];
}

/**
 * What a job of `repositoryId` sees. Call it outside durable Workflow steps and never return the result from one:
 * a step's result is persisted.
 */
export async function jobValues(
  env: CloudflareBindings,
  db: DrizzleDB,
  repositoryId: string
): Promise<JobValues> {
  // The repository's own rows, every instance-wide variable, and the instance-wide secrets listed for it.
  const rows = await db
    .select()
    .from(actionsVariables)
    .where(
      or(
        eq(actionsVariables.repositoryId, repositoryId),
        and(
          isNull(actionsVariables.repositoryId),
          or(
            eq(actionsVariables.kind, 'variable'),
            inArray(
              actionsVariables.id,
              db
                .select({ id: actionsSecretRepositories.secretId })
                .from(actionsSecretRepositories)
                .where(eq(actionsSecretRepositories.repositoryId, repositoryId))
            )
          )
        )
      )
    )
    .all();
  // Instance-wide first, so the repository's own row of a name replaces it.
  rows.sort(
    (a, b) =>
      (a.repositoryId === null ? 0 : 1) - (b.repositoryId === null ? 0 : 1)
  );
  const out: JobValues = { secrets: {}, vars: {}, notes: [] };
  const configured = secretsConfigured(env);
  let skipped = false;
  for (const r of rows) {
    if (r.kind === 'variable') {
      out.vars[r.name] = r.value;
      continue;
    }
    if (!configured) {
      skipped = true;
      continue;
    }
    const value = await decryptSecret(env, r.repositoryId, r.name, r.value);
    if (value === null) {
      out.notes.push(
        `Secret ${r.name} could not be decrypted (was ACTIONS_SECRETS_KEY changed?), so it is empty in this run. Save it again to fix it.`
      );
      continue;
    }
    out.secrets[r.name] = value;
  }
  if (skipped)
    out.notes.push(
      'This server has no ACTIONS_SECRETS_KEY, so every secret is empty in this run.'
    );
  return out;
}

// ── instance-wide secrets: which repositories they reach ─────────────────────

/** Repositories one instance-wide secret may list: the whole allow-list is replaced in one request. */
export const MAX_SECRET_REPOSITORIES = 500;

/** For each of `secretIds`, the repositories it reaches (ids). */
export async function secretRepositories(
  db: DrizzleDB,
  secretIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(secretIds.map((id) => [id, []]));
  if (!secretIds.length) return out;
  const rows = await db
    .select()
    .from(actionsSecretRepositories)
    .where(inJsonArray(actionsSecretRepositories.secretId, secretIds))
    .all();
  for (const r of rows) out.get(r.secretId)?.push(r.repositoryId);
  return out;
}

/** The instance-wide secret `name`, or undefined. */
export function instanceSecret(db: DrizzleDB, name: string) {
  return db
    .select()
    .from(actionsVariables)
    .where(
      and(
        isNull(actionsVariables.repositoryId),
        eq(actionsVariables.kind, 'secret'),
        eq(actionsVariables.name, name)
      )
    )
    .get();
}

/**
 * Replaces the repositories instance-wide secret `secretId` reaches with `repositoryIds` (existing repositories only;
 * the caller checked them). One D1 batch, so a job never reads a half-written list. Returns what was added and removed.
 */
export async function setSecretRepositories(
  db: DrizzleDB,
  secretId: string,
  repositoryIds: string[]
): Promise<{ added: string[]; removed: string[] }> {
  const wanted = [...new Set(repositoryIds)];
  const now = new Date();
  // 3 columns a row: 33 rows stay under D1's 100 bound parameters.
  const inserts = [];
  for (let i = 0; i < wanted.length; i += 33)
    inserts.push(
      db
        .insert(actionsSecretRepositories)
        .values(
          wanted
            .slice(i, i + 33)
            .map((repositoryId) => ({ secretId, repositoryId, createdAt: now }))
        )
        .onConflictDoNothing()
    );
  // Replacing from a stale diff can merge two concurrent allow-lists. Delete the
  // current set and insert the full requested set in one transaction instead.
  // RETURNING also makes the audit delta describe the set actually replaced.
  const [previous] = await db.batch([
    db
      .delete(actionsSecretRepositories)
      .where(eq(actionsSecretRepositories.secretId, secretId))
      .returning({ repositoryId: actionsSecretRepositories.repositoryId }),
    ...inserts,
  ]);
  const before = previous.map((row) => row.repositoryId);
  const added = wanted.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !wanted.includes(id));
  return { added, removed };
}

/** What job logs hide: each secret, and each line of a multi-line one that could be secret alone (`maskValues`). */
export function secretMasks(secrets: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const v of Object.values(secrets))
    for (const m of maskValues(v)) out.add(m);
  // Longest first, so a secret that contains another is masked whole.
  return [...out].sort((a, b) => b.length - a.length);
}
