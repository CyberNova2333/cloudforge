// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { getSettings, signupDomains } from '../lib/settings';
import { signupOpen, verificationNeeded } from '../auth/signup';
import { emailConfigured } from '../lib/email';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { and, eq, lt, sql } from 'drizzle-orm';
import { users } from '../db/auth.schema';
import { instanceSettings } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';
import {
  setupCodeMissing,
  setupCodeRequired,
  verifySetupCode,
} from '../lib/setup-code';
import { USERNAME_RE, isReservedUsername } from '../lib/usernames';
import { emailClaimedByOther } from '../lib/email-claims';
import { d1Of } from '../pulls/events';
import type { AppEnv } from '../variables';
import {
  json200Response,
  json400Response,
  json403Response,
  json409Response,
  okSchema,
  validationHook,
} from './openapi-helpers';

export const setupRouter = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

export async function countUsers(db: DrizzleDB) {
  const r = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(users)
    .get();
  return Number(r?.count ?? 0);
}

// Internal state kept beside the settings: who is creating the first admin right now.
const SETUP_CLAIM_KEY = 'setup.claim';
/** A claim older than this (its request died before releasing it) can be taken over. */
const SETUP_CLAIM_SECONDS = 60;

/**
 * Claims the creation of the first admin, so two requests racing through an empty instance can't both make one:
 * one conditional write of the claim row, which a stale claim (older than a minute) gives way to. The nonce
 * identifies this request's claim, or null when another request holds it.
 */
async function claimSetup(db: DrizzleDB): Promise<string | null> {
  const nonce = crypto.randomUUID();
  const now = new Date();
  const res = await db
    .insert(instanceSettings)
    .values({ key: SETUP_CLAIM_KEY, value: { nonce }, updatedAt: now })
    .onConflictDoUpdate({
      target: instanceSettings.key,
      set: { value: { nonce }, updatedAt: now },
      setWhere: lt(
        instanceSettings.updatedAt,
        new Date(now.getTime() - SETUP_CLAIM_SECONDS * 1000)
      ),
    })
    .run();
  return res.meta.changes === 1 ? nonce : null;
}

/** Gives back this request's claim (creating the admin failed), so setup can be tried again at once. */
async function releaseSetup(db: DrizzleDB, nonce: string) {
  await db
    .delete(instanceSettings)
    .where(
      and(
        eq(instanceSettings.key, SETUP_CLAIM_KEY),
        sql`json_extract(${instanceSettings.value}, '$.nonce') = ${nonce}`
      )
    );
}

export const SETUP_CODE_MISSING =
  'This instance is reachable from the internet, so creating the first administrator needs a setup code. Set the SETUP_CODE_HASH secret first (see docs/setup.md).';

export const usernameSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(
    USERNAME_RE,
    'Username may only contain alphanumeric characters or single hyphens, and cannot begin or end with a hyphen.'
  )
  .refine((u) => !isReservedUsername(u), 'Username is reserved.');

const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Setup'],
  responses: {
    ...json200Response(
      z.object({
        setupRequired: z.boolean(),
        /** The first admin must present the one-time setup code. */
        codeRequired: z.boolean(),
        /** Setup needs a code, but none is configured (SETUP_CODE_HASH): it is refused until one is. */
        codeMissing: z.boolean(),
        /** The instance's display name. */
        appName: z.string(),
        /** The interface language for people who haven't picked one: auto follows the browser. */
        defaultLanguage: z.enum(['auto', 'zh', 'en']),
        /** Self sign-up (Site admin → Settings → Accounts), for the sign-in and sign-up pages. */
        signup: z.object({
          enabled: z.boolean(),
          /** Only these email domains may sign up; empty allows any. */
          domains: z.array(z.string()),
          /** New accounts confirm their email before their first sign-in. */
          verification: z.boolean(),
        }),
        /** Email is set up, so the sign-in page offers "Forgot password?" (a reset link by email). */
        passwordReset: z.boolean(),
      }),
      'Setup status'
    ),
  },
});

setupRouter.openapi(statusRoute, async (c) => {
  const db = c.get('db');
  const setupRequired = (await countUsers(db)) === 0;
  const s = await getSettings(db, c.env, [
    'app.name',
    'ui.default_language',
    'signup.enabled',
    'signup.allowed_domains',
  ]);
  return c.json(
    {
      setupRequired,
      codeRequired: setupRequired && setupCodeRequired(c.env),
      codeMissing: setupRequired && setupCodeMissing(c.env, c.req.url),
      appName: s['app.name'],
      defaultLanguage: s['ui.default_language'],
      signup: {
        // Closed while it would need email that can't be sent (checkSignup refuses then).
        enabled: !setupRequired && (await signupOpen(db, c.env)),
        domains: signupDomains(s['signup.allowed_domains']),
        verification: await verificationNeeded(db, c.env),
      },
      passwordReset: !setupRequired && emailConfigured(c.env),
    },
    200
  );
});

const createAdminRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Setup'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(100),
            username: usernameSchema,
            email: z.email(),
            password: z.string().min(8).max(128),
            /** The one-time setup code, when the instance has one. */
            code: z.string().max(100).optional(),
          }),
        },
      },
    },
  },
  responses: {
    ...json200Response(okSchema, 'Admin created'),
    ...json400Response,
    ...json403Response,
    ...json409Response,
  },
});

setupRouter.openapi(createAdminRoute, async (c) => {
  const db = c.get('db');
  // Closed once any user exists, so it can't be used to escalate.
  if ((await countUsers(db)) > 0)
    return c.json({ error: 'Setup has already been completed' }, 403);
  const { name, username, email, password, code } = c.req.valid('json');
  if (setupCodeMissing(c.env, c.req.url))
    return c.json({ error: SETUP_CODE_MISSING }, 403);
  if (!(await verifySetupCode(c.env, code)))
    return c.json({ error: 'The setup code is missing or wrong.' }, 403);
  const claim = await claimSetup(db);
  if (!claim)
    return c.json(
      {
        error:
          'The first administrator is being created. Try again in a minute.',
      },
      409
    );
  // Checked again under the claim: a request that finished meanwhile made the first admin.
  if ((await countUsers(db)) > 0) {
    await releaseSetup(db, claim);
    return c.json({ error: 'Setup has already been completed' }, 403);
  }
  try {
    const normalizedEmail = email.toLowerCase();
    if (await emailClaimedByOther(db, normalizedEmail))
      throw new Error('That email belongs to another member.');
    // Hash before writing anything, using the same implementation as sign-in. The ordinary admin API creates
    // the user before its credentials and cannot fence the insertion against a setup lease taken over meanwhile.
    const authContext = await c.get('auth').$context;
    const hash = await authContext.password.hash(password);
    const id = crypto.randomUUID();
    const now = Date.now();
    const d1 = d1Of(db);
    const [created] = await d1.batch([
      d1
        .prepare(
          `INSERT INTO users
        (id, name, email, email_verified, created_at, updated_at, role, username, display_username)
        SELECT ?, ?, ?, 1, ?, ?, 'admin', ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM users)
          AND EXISTS (SELECT 1 FROM instance_settings WHERE key = ? AND json_extract(value, '$.nonce') = ?)`
        )
        .bind(
          id,
          name,
          normalizedEmail,
          now,
          now,
          username.toLowerCase(),
          username,
          SETUP_CLAIM_KEY,
          claim
        ),
      d1
        .prepare(
          `INSERT INTO accounts
        (id, account_id, provider_id, user_id, password, created_at, updated_at)
        SELECT ?, id, 'credential', id, ?, ?, ? FROM users WHERE id = ?`
        )
        .bind(crypto.randomUUID(), hash, now, now, id),
    ]);
    if (created.meta.changes !== 1) {
      await releaseSetup(db, claim);
      return c.json(
        {
          error:
            'Setup has already been completed or this setup attempt expired.',
        },
        409
      );
    }
  } catch (e) {
    await releaseSetup(db, claim);
    return c.json(
      { error: e instanceof Error ? e.message : 'Could not create user' },
      400
    );
  }
  return c.json({ ok: true as const }, 200);
});
