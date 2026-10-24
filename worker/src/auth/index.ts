// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { betterAuth } from 'better-auth';
import { admin, jwt, openAPI, username } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { oauthResources } from '../db/auth.schema';
import { schema } from '../db/schema';
import { isValidUsername } from '../lib/usernames';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { namespaceTaken } from '../lib/namespaces';
import { isAgentUser } from '../agents/identity';
import { eq } from 'drizzle-orm';
import { mcpModerators } from '../db/app.schema';
import {
  emailConfigured,
  sendPasswordReset,
  sendSignupVerification,
} from '../lib/email';
import { recordAudit } from '../lib/audit';
import { emailClaimedByOther } from '../lib/email-claims';
import {
  checkResend,
  checkSignup,
  mustVerifyEmail,
  verificationRequired,
} from './signup';

/** How long a sign-up verification link works. */
const VERIFY_HOURS = 24;

/** How long a forgot-password link from the sign-in page works (an admin's link: lib/password-reset.ts). */
export const RESET_MINUTES = 60;

/** The /mcp URL: the OAuth protected resource and token audience (RFC 8707). */
export const mcpResource = (baseURL: string) =>
  `${baseURL.replace(/\/$/, '')}/mcp`;

/**
 * Marks clients with only loopback or app-scheme redirect URIs and no `application_type` as
 * native; the "web" default forbids http://localhost redirects.
 */
function nativeClientRegistration(body: unknown) {
  const b = body as
    { application_type?: string; redirect_uris?: unknown } | undefined;
  if (!b || b.application_type !== undefined) return;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  const native = (u: unknown) => {
    try {
      const url = new URL(String(u));
      if (url.protocol === 'http:')
        return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      return url.protocol !== 'https:';
    } catch {
      return false;
    }
  };
  if (uris.length && uris.every(native))
    return { ...b, application_type: 'native' };
}

/**
 * Seeds the `/mcp` protected resource. Not the plugin's `resources` option: that seeds on every
 * auth instance, i.e. every request.
 */
async function ensureMcpResource(
  db: DrizzleD1Database<typeof schema>,
  baseURL: string
) {
  const now = new Date();
  await db
    .insert(oauthResources)
    .values({
      id: crypto.randomUUID(),
      identifier: mcpResource(baseURL),
      name: 'CloudForge MCP server',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: oauthResources.identifier });
}

/** `<origin>/api/auth`, https except on loopback: matches the `iss` oauth-provider signs. */
export function oauthIssuer(baseURL: string) {
  const url = new URL(`${baseURL.replace(/\/$/, '')}/api/auth`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) url.protocol = 'https:';
  return url.toString().replace(/\/$/, '');
}

/**
 * A moderator app never gets a code without the consent screen. better-auth skips the screen once a consent exists,
 * and a native client's loopback redirect matches any port, so any local process could otherwise open the authorize
 * URL in the user's browser and catch a moderator token. This adds `prompt=consent` to every authorization of a
 * client that is someone's moderator — the plugin then always redirects to the consent page — except when
 * /oauth2/authorize is the plugin re-entering from POST /oauth2/consent: that is the screen being submitted (session
 * and signed query already checked), and the plugin has just removed `consent` from the prompt itself.
 *
 * Re-entries after sign-in (the plugin's own after hook) and /oauth2/continue also come through here, so they are
 * covered. `prompt=none` plus `consent` is invalid, so a silent request gets an error, never a code. Returns the
 * context to merge, or undefined to leave the request as it is.
 */
async function moderatorAuthorizeNeedsConsent(
  db: DrizzleD1Database<typeof schema>,
  ctx: {
    method?: string;
    query?: unknown;
    body?: unknown;
    request?: Request;
    authorizeSettings?: { isAuthorize?: boolean };
  }
) {
  if (
    ctx.request &&
    new URL(ctx.request.url).pathname.endsWith('/oauth2/consent')
  )
    return;
  // Where the plugin reads the parameters from: the form body of a POST to /oauth2/authorize, else the query.
  const isAuthorize =
    (ctx.authorizeSettings ?? { isAuthorize: true }).isAuthorize === true;
  const key = ctx.method === 'POST' && isAuthorize ? 'body' : 'query';
  const params = ctx[key];
  if (!params || typeof params !== 'object') return;
  const p = params as Record<string, unknown>;
  if (typeof p.client_id !== 'string') return;
  const moderator = await db
    .select({ clientId: mcpModerators.clientId })
    .from(mcpModerators)
    .where(eq(mcpModerators.clientId, p.client_id))
    .get();
  if (!moderator) return;
  const prompts = new Set(
    (typeof p.prompt === 'string' ? p.prompt : '').split(' ').filter(Boolean)
  );
  prompts.add('consent');
  return { [key]: { ...p, prompt: [...prompts].join(' ') } };
}

/** OAuth scopes MCP clients may request. */
export const OAUTH_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

function createAuth(env?: CloudflareBindings) {
  // No env during CLI schema generation.
  const db = env ? drizzle(env.DB, { schema }) : ({} as any);
  const baseURL = env?.BASE_URL || 'http://localhost:8080';

  return betterAuth({
    secret: env?.BETTER_AUTH_SECRET,
    baseURL,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      usePlural: true,
      // Explicit so the schema check passes for the CLI instance, which has no database.
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      // Setup and invitations create users directly; self sign-up is open only while Site admin turns it on
      // (checkSignup, below). It never signs in by itself: the page signs in, or the emailed link does.
      disableSignUp: false,
      autoSignIn: false,
      minPasswordLength: 8,
      // Forgot password (the sign-in page) and a site admin's reset link (lib/password-reset.ts) share the
      // token store and POST /reset-password. A new password signs out every other session of that person.
      resetPasswordTokenExpiresIn: RESET_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Agents have no password to reset; without email set up the sign-in page hides the link.
        if (!env || !emailConfigured(env) || (await isAgentUser(db, user.id)))
          return;
        await sendPasswordReset(env, db, {
          to: user.email,
          name: user.name,
          url,
          expires: `${RESET_MINUTES} minutes`,
        });
      },
      onPasswordReset: async ({ user }) => {
        if (!env) return;
        const name = (user as { username?: string | null }).username;
        await recordAudit(db, {
          repositoryId: null,
          actorId: user.id,
          action: 'user.password_reset',
          target: `@${name ?? user.name}`,
          data: {},
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_HOURS * 3600,
      // Only to a self sign-up that must confirm its email (Site admin requires it, and email is set up). During
      // the sign-up request itself the account isn't marked as a self sign-up yet (user.create.after runs once the
      // request is done), so there the requirement alone decides; a resend is already limited by checkResend.
      sendVerificationEmail: async ({ user, url }, request) => {
        if (!env) return;
        const signingUp =
          !!request && new URL(request.url).pathname.endsWith('/sign-up/email');
        const send = signingUp
          ? await verificationRequired(db, env)
          : await mustVerifyEmail(db, env, user.id);
        if (!send) return;
        await sendSignupVerification(env, db, {
          to: user.email,
          name: user.name,
          url,
          hours: VERIFY_HOURS,
        });
      },
    },
    // jwt() only signs OAuth access tokens; its session-JWT endpoint is off.
    disabledPaths: ['/token'],
    plugins: [
      openAPI(),
      admin(),
      username({
        minUsernameLength: 1,
        maxUsernameLength: 39,
        // Also covers better-auth's update-user endpoint.
        usernameValidator: isValidUsername,
      }),
      jwt(),
      // OAuth 2.1 server for MCP clients: dynamic registration (RFC 7591), PKCE, JWTs for /mcp.
      oauthProvider({
        loginPage: '/login',
        consentPage: '/oauth/consent',
        scopes: OAUTH_SCOPES,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // /mcp is the only resource; any client may request it.
        enforcePerClientResources: false,
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!env) return;
        if (ctx.path === '/sign-up/email') {
          await checkSignup(db, env, ctx.body);
          return;
        }
        if (ctx.path === '/send-verification-email') {
          await checkResend(db, env, ctx.body);
          return;
        }
        if (!ctx.path.startsWith('/oauth2/')) return;
        await ensureMcpResource(db, baseURL);
        if (ctx.path === '/oauth2/authorize') {
          const context = await moderatorAuthorizeNeedsConsent(db, ctx);
          if (context) return { context };
        }
        if (ctx.path === '/oauth2/register') {
          const body = nativeClientRegistration(ctx.body);
          if (body) return { context: { body } };
        }
      }),
    },
    // In-memory limits would be per isolate.
    rateLimit: { enabled: true, storage: 'database' },
    databaseHooks: {
      session: {
        create: {
          // Agents are accounts without sign-in: no session by any route (password, impersonation), and so
          // no personal access tokens or OAuth consents either.
          before: async (session) => {
            if (env && (await isAgentUser(db, session.userId)))
              throw new APIError('FORBIDDEN', {
                message: 'Agents can’t sign in.',
              });
            // A self sign-up signs in only once its email is confirmed (while Site admin requires that).
            if (env && (await mustVerifyEmail(db, env, session.userId)))
              throw new APIError('FORBIDDEN', {
                message:
                  'Confirm your email first: open the link we sent you, then sign in.',
                code: 'EMAIL_NOT_VERIFIED',
              });
            return { data: session };
          },
        },
      },
      account: {
        create: {
          // Nor credentials: covers admin set-user-password, create-user with a password, any linkAccount.
          before: async (account) => {
            if (env && (await isAgentUser(db, account.userId)))
              throw new APIError('FORBIDDEN', {
                message: 'Agents can’t have a password.',
              });
            return { data: account };
          },
        },
      },
      verification: {
        create: {
          // Nor a password reset token: forgot-password answers for an agent's address as for an unknown one.
          before: async (verification) => {
            if (
              env &&
              verification.identifier.startsWith('reset-password:') &&
              (await isAgentUser(db, verification.value))
            )
              return false;
            return { data: verification };
          },
        },
      },
      user: {
        create: {
          // Only a self sign-up starts unverified (and so may have to confirm its email before signing in).
          // Setup, invitations and the admin API vouch for the address: those accounts start verified.
          before: async (user, ctx) => {
            if (env && (await emailClaimedByOther(db, user.email)))
              throw new APIError('CONFLICT', {
                message: 'That email belongs to another member.',
              });
            if (ctx?.path === '/sign-up/email') return;
            return { data: { ...user, emailVerified: true } };
          },
        },
        update: {
          // Usernames share the URL namespace with the team slug.
          before: async (data, ctx) => {
            // An agent stays a plain user (no site admin) under the handle and `.invalid` email it was
            // created with. The hook gets no `where`; the admin endpoints (set-role, update-user) name
            // their target as `body.userId`, and agents have no session to update themselves with.
            const target = (ctx?.body as { userId?: unknown } | undefined)
              ?.userId;
            const fields = data as Record<string, unknown>;
            const touches = (keys: string[]) =>
              keys.some((k) => fields[k] !== undefined);
            if (
              env &&
              typeof target === 'string' &&
              touches(['role', 'username', 'displayUsername', 'email']) &&
              (await isAgentUser(db, target))
            ) {
              if (touches(['role']))
                throw new APIError('FORBIDDEN', {
                  message: 'An agent’s role can’t be changed.',
                });
              throw new APIError('FORBIDDEN', {
                message: 'An agent’s username and email can’t be changed.',
              });
            }
            const username = (data as { username?: string }).username;
            const userId =
              typeof target === 'string'
                ? target
                : ctx?.context.session?.user.id;
            if (
              env &&
              typeof fields.email === 'string' &&
              (await emailClaimedByOther(db, fields.email, userId))
            )
              throw new APIError('CONFLICT', {
                message: 'That email belongs to another member.',
              });
            if (
              username &&
              env &&
              (await namespaceTaken(db, username, { userId }))
            ) {
              throw new APIError('BAD_REQUEST', {
                message: 'Username is not available.',
              });
            }
            return { data };
          },
        },
        delete: {
          // Deleting an agent keeps its user (history, attribution); admin remove-user would cascade it away.
          before: async (user) => {
            if (env && (await isAgentUser(db, user.id)))
              throw new APIError('FORBIDDEN', {
                message: 'Delete agents from Site admin → Agents.',
              });
          },
        },
      },
    },
    advanced: {
      cookiePrefix: 'cloudforge',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: {
        sameSite: 'Lax',
        secure: baseURL.startsWith('https://'),
      },
    },
    trustedOrigins: [baseURL],
  });
}

// For `yarn auth:generate`.
export const auth = createAuth();

export { createAuth };
