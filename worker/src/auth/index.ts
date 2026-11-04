// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { betterAuth } from 'better-auth';
import {
  oidcSignInPlugin,
  isOidcProvisionalSession,
  supersedeOidcSignIn,
} from '../oidc/sign-in';
import { parseSessionOutput } from 'better-auth/db';
import { jwt, openAPI, username } from 'better-auth/plugins';
import { repositorySafeAdmin } from './user-deletion';
import { oauthProvider } from '@better-auth/oauth-provider';
import { guardOAuthIntrospection, oauthGrantOptions } from './oauth-grants';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { oauthResources } from '../db/auth.schema';
import { schema } from '../db/schema';
import { isValidUsername } from '../members/usernames';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { isNamespaceConflict, namespaceTaken } from '../members/namespaces';
import { isAgentUser } from '../agents/identity';
import { eq } from 'drizzle-orm';
import { mcpModerators } from '../db/app.schema';
import {
  emailConfigured,
  sendPasswordReset,
  sendSignupVerification,
} from '../notifications/email';
import { recordAudit } from '../audit/service';
import { emailClaimedByOther } from '../members/email-claims';
import {
  cloudforgeTwoFactor,
  mfaSessionPaths,
  recordMfaChallenge,
  allowsMfaContinuation,
  authenticationForNewSession,
} from './two-factor';
import {
  installSessionVersionGuard,
  isCurrentSession,
  readSessionAuthentication,
} from './assurance';
import { requireRecentNativeAuthentication } from './recent';
import {
  captureNativeAdminWrite,
  nativeAdminDatabase,
  isNativeAdminAuthorizationFailure,
} from './native-admin';
import { requireNativePolicy } from './policy';
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
  const adapterDb = env ? drizzle(nativeAdminDatabase(env.DB), { schema }) : db;
  const adapterFactory = drizzleAdapter(adapterDb, {
    provider: 'sqlite',
    usePlural: true,
    // Explicit so the schema check passes for the CLI instance, which has no database.
    schema,
  });
  const database: typeof adapterFactory = (options) => {
    const adapter = adapterFactory(options);
    return new Proxy(adapter, {
      get(target, property, receiver) {
        const operation = Reflect.get(target, property, receiver);
        if (
          !['create', 'update', 'updateMany', 'delete', 'deleteMany'].includes(
            String(property)
          ) ||
          typeof operation !== 'function'
        )
          return operation;
        return async (...args: unknown[]) => {
          try {
            return await Reflect.apply(operation, target, args);
          } catch (error) {
            if (isNativeAdminAuthorizationFailure(error))
              throw new APIError('FORBIDDEN', {
                code: 'ADMIN_AUTHORIZATION_CHANGED',
                message:
                  'Administrative authorization changed. Refresh and try again.',
              });
            // A pre-read cannot fence a concurrent namespace claim. Translate only the
            // managed SQL guard, after the ordinary SDK identity/proof hooks have run.
            if (
              (args[0] as { model?: unknown } | undefined)?.model === 'user' &&
              isNamespaceConflict(error)
            )
              throw new APIError('CONFLICT', {
                message: 'Username is not available.',
              });
            throw error;
          }
        };
      },
    });
  };

  return betterAuth({
    secret: env?.BETTER_AUTH_SECRET,
    baseURL,
    database,
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
      // Only to a self sign-up that must confirm its email (Site admin requires it or limits domains, and email is
      // set up). During the sign-up request itself the account isn't marked as a self sign-up yet (user.create.after
      // runs once the request is done), so there the requirement alone decides; a resend is already limited by
      // checkResend.
      sendVerificationEmail: async ({ user, url }, request) => {
        if (!env) return;
        const signingUp =
          !!request && new URL(request.url).pathname.endsWith('/sign-up/email');
        const send = signingUp
          ? await verificationRequired(db, env)
          : emailConfigured(env) && (await mustVerifyEmail(db, env, user.id));
        if (!send) return;
        await sendSignupVerification(env, db, {
          to: user.email,
          name: user.name,
          url,
          hours: VERIFY_HOURS,
        });
      },
    },
    account: {
      accountLinking: {
        // External identities must never acquire a local account through a matching email.
        disableImplicitLinking: true,
        // Explicit linking stays closed until callbacks have a live, session-bound authorization fence.
        enabled: false,
      },
    },
    // jwt() only signs OAuth access tokens; its session-JWT endpoint is off.
    disabledPaths: ['/token'],
    plugins: [
      openAPI(),
      repositorySafeAdmin(env, db),
      username({
        minUsernameLength: 1,
        maxUsernameLength: 39,
        // Also covers better-auth's update-user endpoint.
        usernameValidator: isValidUsername,
      }),
      jwt(),
      // Must precede OAuth's after hook: no authorization code while the password-only session is pending MFA.
      cloudforgeTwoFactor(db, env),
      oidcSignInPlugin(env),
      // OAuth 2.1 server for MCP clients: dynamic registration (RFC 7591), PKCE, JWTs for /mcp.
      oauthProvider({
        ...oauthGrantOptions(env),
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
        await installSessionVersionGuard(ctx, env);
        await requireNativePolicy(ctx, env);
        await requireRecentNativeAuthentication(ctx, db);
        await captureNativeAdminWrite(ctx, db);
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
      after: createAuthMiddleware(async (ctx) => {
        if (env) {
          const guarded = await guardOAuthIntrospection(ctx, env);
          if (guarded) return guarded;
        }
        if (
          env &&
          ctx.path === '/sign-out' &&
          !(ctx.context.returned instanceof APIError) &&
          (ctx.context.returned as { success?: boolean } | undefined)
            ?.success === true
        )
          await supersedeOidcSignIn(ctx, env);
        if (
          !env ||
          !ctx.context.newSession ||
          ctx.context.returned instanceof APIError
        )
          return;
        const created = ctx.context.newSession;
        const current = await readSessionAuthentication(
          env,
          created.session.id
        );
        if (
          !current ||
          current.banned ||
          !isCurrentSession(current, { authVersion: current.userAuthVersion })
        ) {
          await ctx.context.internalAdapter.deleteSession(
            created.session.token
          );
          throw new APIError('UNAUTHORIZED', {
            code: 'MFA_CHALLENGE_CHANGED',
            message: 'Sign in again after the account credentials changed.',
          });
        }
        // This native endpoint returns createSession's raw row rather than the usual output projection.
        if (ctx.path === '/admin/impersonate-user') {
          const result = ctx.context.returned as {
            session?: typeof created.session;
          };
          if (result && result.session && typeof result.session === 'object')
            return ctx.json({
              ...result,
              session: parseSessionOutput(ctx.context.options, result.session),
            });
        }
      }),
    },
    // In-memory limits would be per isolate.
    rateLimit: {
      enabled: true,
      storage: 'database',
      // Each limited request writes D1 (single-threaded). get-session runs on every page load and focus, reads only
      // the caller's own session, and has nothing to guess: it isn't counted. Sign-in, sign-up, resets and OAuth are.
      customRules: { '/get-session': false },
    },
    databaseHooks: {
      session: {
        create: {
          // Agents are accounts without sign-in: no session by any route (password, impersonation), and so
          // no personal access tokens or OAuth consents either.
          before: async (session, ctx) => {
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
            if (env) {
              const user = await env.DB.prepare(
                'SELECT two_factor_enabled, auth_version FROM users WHERE id = ?'
              )
                .bind(session.userId)
                .first<{ two_factor_enabled: number; auth_version: number }>();
              if (!user) throw new APIError('UNAUTHORIZED');
              if (
                user?.two_factor_enabled &&
                !mfaSessionPaths.has(ctx?.path ?? '') &&
                !(
                  ctx && isOidcProvisionalSession(ctx.context, session.userId)
                ) &&
                !(
                  ctx &&
                  (await allowsMfaContinuation(
                    env,
                    session.userId,
                    ctx.path,
                    ctx.context
                  ))
                )
              )
                throw new APIError('FORBIDDEN', {
                  message: 'Sign in with your password and second factor.',
                  code: 'MFA_SIGN_IN_REQUIRED',
                });
              return {
                data: {
                  ...session,
                  ...authenticationForNewSession(
                    ctx?.context ?? ({} as any),
                    ctx?.path,
                    session.userId,
                    user.auth_version,
                    typeof session.impersonatedBy === 'string'
                      ? session.impersonatedBy
                      : undefined
                  ),
                },
              };
            }
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
        update: {
          after: async (account, ctx) => {
            // Includes self-service changes, emailed resets and admin set-password.
            // A pending MFA challenge proved the old password and cannot survive its replacement.
            if (env && account.providerId === 'credential')
              await env.DB.batch([
                env.DB.prepare(
                  "DELETE FROM verifications WHERE value = ? AND identifier LIKE '2fa-%'"
                ).bind(account.userId),
                env.DB.prepare(
                  'DELETE FROM sessions WHERE user_id = ? AND id != ?'
                ).bind(
                  account.userId,
                  ctx?.context.session?.user.id === account.userId
                    ? ctx.context.session.session.id
                    : ''
                ),
              ]);
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
          after: async (verification, ctx) => {
            if (env && ctx)
              await recordMfaChallenge(env, verification, ctx.context);
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
            const name = (user as { username?: unknown }).username;
            if (
              env &&
              typeof name === 'string' &&
              name.length > 0 &&
              (await namespaceTaken(db, name))
            )
              throw new APIError('CONFLICT', {
                message: 'Username is not available.',
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
            if (
              env &&
              (fields.twoFactorEnabled !== undefined ||
                fields.authVersion !== undefined)
            ) {
              throw new APIError('FORBIDDEN', {
                message: 'Use the two-factor authentication settings.',
                code: 'MFA_SETTINGS_REQUIRED',
              });
            }
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
            if (
              env &&
              (await env.DB.prepare(
                'SELECT 1 FROM repositories WHERE owner_id=? LIMIT 1'
              )
                .bind(user.id)
                .first())
            )
              throw new APIError('FORBIDDEN', {
                code: 'USER_OWNS_REPOSITORIES',
                message:
                  'Delete this member’s repositories through their normal deletion flow first.',
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

/**
 * The better-auth instance for `env`, made once per isolate: building one costs about 5 ms of CPU, on every request
 * otherwise. Sharing it is safe: creating it does no I/O (its schema check compares objects in memory), each request
 * gets its own endpoint context, and its closures read `env` when they run.
 */
type Auth = ReturnType<typeof createAuth>;
const instances = new WeakMap<CloudflareBindings, Auth>();
export function authFor(env: CloudflareBindings): Auth {
  let instance = instances.get(env);
  if (!instance) instances.set(env, (instance = createAuth(env)));
  return instance;
}

export { createAuth };
