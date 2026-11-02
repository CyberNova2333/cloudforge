// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../variables';
import { delegationsFor, setDelegations } from '../../review/delegate';
import {
  errorSchema,
  json200Response,
  json400Response,
  json401Response,
  validationHook,
} from '../../http/openapi-helpers';
import { auditEventSchema } from '../../http/schemas';
import { getUserSettings, setUserSettings } from '../preferences';

/** The signed-in person's own preferences: `/api/me/...`. */
export const meRouter = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});
meRouter.get('/authentication-policy', (c) => {
  c.header('Cache-Control', 'no-store');
  const browser = c.get('browserSession');
  if (!browser) return c.json({ error: 'Unauthorized' }, 401);
  const { access, enrolled, version, requireMfa } = browser.policy;
  return c.json({
    sessionId: browser.id,
    policy: { version, requireMfa },
    access,
    enrolled,
  });
});

const authenticationSchema = z
  .object({
    /** Public row id, also returned by get-session; lets clients bind evidence to the expected browser session. */
    sessionId: z.string(),
    strength: z.enum([
      'unknown',
      'password',
      'oidc',
      'multi_factor',
      'email_verification',
      'impersonated',
    ]),
    primary: z
      .object({
        method: z.enum([
          'password',
          'oidc',
          'email_verification',
          'impersonation',
        ]),
        verifiedAt: z.string().datetime(),
      })
      .nullable(),
    secondFactor: z
      .object({
        method: z.enum(['totp', 'recovery_code']),
        verifiedAt: z.string().datetime(),
      })
      .nullable(),
  })
  .extend({ source: z.object({ method: z.literal('oidc') }).optional() })
  .openapi('SessionAuthentication');

const authenticationRoute = createRoute({
  method: 'get',
  path: '/authentication',
  tags: ['Users'],
  summary: 'The authentication proved by this browser session',
  description:
    'Read-only, cookie-authenticated evidence for the current browser. Older sessions without recorded evidence are unknown; account enrollment alone does not prove this session completed a second factor.',
  responses: {
    ...json200Response(authenticationSchema, 'Current browser authentication'),
    ...json401Response,
  },
});
meRouter.openapi(authenticationRoute, async (c) => {
  const browser = c.get('browserSession');
  if (!browser) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ sessionId: browser.id, ...browser.authentication }, 200);
});

const delegationsSchema = z
  .object({
    /** Every reviewer agent, and whether CloudForge AI decides its findings on your pull requests. */
    agents: z.array(
      z.object({
        handle: z.string(),
        name: z.string(),
        color: z.string(),
        /** Its findings always come to you: it can't be delegated. */
        guarded: z.boolean(),
        delegated: z.boolean(),
      })
    ),
    /**
     * CloudForge AI's answers for you since UTC midnight, newest first (`finding.delegated`). Each one's `data` holds
     * `finding` (its id), `decision` (approve, request_changes, leave), `reason`, `undone` (it no longer stands) and
     * `undoable` (still standing, on an open pull request: POST .../review/flags/{finding}/undo).
     */
    today: z.array(auditEventSchema),
  })
  .openapi('Delegations');

const getRoute = createRoute({
  method: 'get',
  path: '/delegations',
  tags: ['Users'],
  summary: 'Let CloudForge AI decide: your agents and what it did today',
  responses: {
    ...json200Response(delegationsSchema, 'Your delegations'),
  },
});
meRouter.openapi(getRoute, async (c) =>
  c.json(await delegationsFor(c.get('db'), c.get('user')!), 200)
);

const putRoute = createRoute({
  method: 'put',
  path: '/delegations',
  tags: ['Users'],
  summary: 'Choose the agents whose findings CloudForge AI decides for you',
  description:
    'Replaces the set: CloudForge AI decides these agents’ findings on pull requests you open, as you, right ' +
    'after each review. 400 for an agent nobody has; 422 for a guarded agent (its findings always come to a person).',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            /** Agent handles. */
            agents: z.array(z.string().min(1).max(100)).max(200),
          }),
        },
      },
    },
  },
  responses: {
    ...json200Response(delegationsSchema, 'Your delegations now'),
    ...json400Response,
    422: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'A guarded agent',
    },
  },
});
meRouter.openapi(putRoute, async (c) => {
  const user = c.get('user')!;
  const result = await setDelegations(
    c.get('db'),
    user,
    c.req.valid('json').agents
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(await delegationsFor(c.get('db'), user), 200);
});

// ── Preferences ──────────────────────────────────────────────────────────────
// Personal settings, kept with the account (lib/user-settings.ts lists the keys).

const preferencesSchema = z
  .object({
    /** Interface language; null follows the instance default (Site admin → Settings), then the browser. */
    language: z.enum(['zh', 'en']).nullable(),
    /** Which notifications also arrive by email: participating (the default), all, or off. */
    notificationEmail: z.enum(['participating', 'all', 'off']),
  })
  .openapi('Preferences');

const getPreferencesRoute = createRoute({
  method: 'get',
  path: '/preferences',
  tags: ['Users'],
  summary: 'Your preferences, kept with your account',
  responses: {
    ...json200Response(preferencesSchema, 'Your preferences'),
  },
});
meRouter.openapi(getPreferencesRoute, async (c) =>
  c.json(await getUserSettings(c.get('db'), c.get('user')!.id), 200)
);

const putPreferencesRoute = createRoute({
  method: 'put',
  path: '/preferences',
  tags: ['Users'],
  summary: 'Change your preferences',
  description:
    'Changes only the preferences in the body; null goes back to the default.',
  request: {
    body: {
      content: {
        'application/json': { schema: preferencesSchema.partial() },
      },
    },
  },
  responses: {
    ...json200Response(preferencesSchema, 'Your preferences now'),
    ...json400Response,
  },
});
meRouter.openapi(putPreferencesRoute, async (c) => {
  const db = c.get('db');
  const userId = c.get('user')!.id;
  await setUserSettings(db, userId, c.req.valid('json'));
  return c.json(await getUserSettings(db, userId), 200);
});
