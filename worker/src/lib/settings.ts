// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DrizzleDB } from '../db/middleware';
import { instanceSettings } from '../db/app.schema';
import { DEFAULT_APP_NAME } from './app-name';
import { SIZES, type InstanceType } from '../actions/runner-sizes';

/**
 * Instance settings a site admin changes in Site admin, without a deploy. Each has a default:
 * the wrangler var it replaces (so existing deploys keep working), or a built-in value. Values
 * are read only where they are used (invitations, reviews, the MCP handshake, page loads), never
 * on every request; deploy-time facts (BASE_URL, bucket names, the R2 account) stay in wrangler.
 */
type Definition<T> = {
  label: string;
  description: string;
  group: 'General' | 'Accounts' | 'AI models' | 'Reviews' | 'Actions';
  schema: z.ZodType<T>;
  /** A choice setting's options, by value: how Site admin names each one. */
  choices?: Record<string, string>;
  default: (env: CloudflareBindings) => T;
  /** Another setting this one takes its (resolved, override included) value from until it is overridden itself. */
  follows?: string;
};

const modelId = z
  .string()
  .trim()
  .regex(
    /^@cf\/[\w.-]+\/[\w.:-]+$/,
    'A Workers AI model id, like @cf/zai-org/glm-5.3'
  );

/**
 * The longest a Pi review may run. Counted from the reviewer row's created_at — PI_START_SLACK_MS, this,
 * PI_RECHECK_MS and PI_EXPIRE_SLACK_MS (review/pi-contract.ts) — it still ends before stale recovery
 * (REVIEW_STALE_MS, review/head.ts) could fail a row that is still being reviewed. The settings test pins it.
 */
export const PI_MAX_MINUTES = 60;

/**
 * The longest a lesson (an agent learning from dismissed change requests) may run. With PI_START_SLACK_MS,
 * PI_RECHECK_MS and PI_EXPIRE_SLACK_MS it ends well before LEARN_STALE_MS (learn/recover.ts) could requeue it.
 */
export const LEARN_MAX_MINUTES = 30;

const whole = (min: number, max: number) => z.number().int().min(min).max(max);

/** Email domains, separated by commas and/or spaces; empty is allowed. */
const DOMAINS_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:[\s,]+|$))*$/i;

/** The domains of `signup.allowed_domains`, lowercased; empty means any domain. */
export function signupDomains(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export const SETTINGS = {
  'app.name': {
    label: 'Instance name',
    description:
      'Shown in page titles, sign-in and setup pages, invitation emails, the git sign-in prompt, and as the MCP server name.',
    group: 'General',
    schema: z.string().trim().min(1).max(60),
    default: (env) => env.APP_NAME?.trim() || DEFAULT_APP_NAME,
  } satisfies Definition<string>,
  'ui.default_language': {
    label: 'Default language',
    description:
      'The interface language for visitors and for members who have not picked one in their settings. Follow the browser shows Chinese when the browser prefers it, else English.',
    group: 'General',
    schema: z.enum(['auto', 'zh', 'en']),
    default: () => 'auto' as const,
    choices: { auto: 'Follow the browser', zh: '中文', en: 'English' },
  } satisfies Definition<'auto' | 'zh' | 'en'>,
  'signup.enabled': {
    label: 'Self sign-up',
    description:
      'Anyone who can reach this instance can create a member account from the sign-in page, without an invitation. Off: people join by invitation only.',
    group: 'Accounts',
    schema: z.boolean(),
    default: () => false,
  } satisfies Definition<boolean>,
  'signup.allowed_domains': {
    label: 'Sign-up email domains',
    description:
      'Only email addresses at these domains can sign up, separated by commas (for example: example.com, example.org). Empty allows any address. A list also makes sign-ups confirm their address by email, so self sign-up stays closed until outbound email (Email Sending) is set up.',
    group: 'Accounts',
    schema: z
      .string()
      .trim()
      .max(500)
      .regex(DOMAINS_RE, 'Use domains like example.com, separated by commas'),
    default: () => '',
  } satisfies Definition<string>,
  'signup.require_verification': {
    label: 'Verify email on sign-up',
    description:
      'Accounts made by self sign-up must open the link emailed to them before they can sign in. Until outbound email (Email Sending) is set up, self sign-up stays closed while this is on; invited members and the first admin are never asked.',
    group: 'Accounts',
    schema: z.boolean(),
    default: () => true,
  } satisfies Definition<boolean>,
  'email.from': {
    label: 'Invitation sender',
    description:
      'The address invitation emails come from. Its domain must be onboarded to Cloudflare Email Sending.',
    group: 'General',
    schema: z.string().trim().email(),
    default: (env) => env.FROM_EMAIL,
  } satisfies Definition<string>,
  'ai.resolver_model': {
    label: 'Conflict resolution model',
    description:
      'Workers AI model the conflict-resolution agent uses. It must support tool calling.',
    group: 'AI models',
    schema: modelId,
    default: (env) => env.RESOLVER_MODEL || '@cf/zai-org/glm-5.3',
  } satisfies Definition<string>,
  'ai.summary_model': {
    label: 'Review summary model',
    description:
      'Writes the one-line summary of each changed file in a review.',
    group: 'AI models',
    schema: modelId,
    default: (env) => env.SUMMARY_MODEL || '@cf/zai-org/glm-5.3-flash',
  } satisfies Definition<string>,
  'ai.review_model': {
    label: 'Agent review model',
    description:
      "Runs each reviewer agent's single-pass review (engine: pass, and engine: pi where Pi isn't set up) and writes its findings' explanations and diagrams.",
    group: 'AI models',
    schema: modelId,
    default: (env) => env.REVIEW_MODEL || '@cf/zai-org/glm-5.3',
  } satisfies Definition<string>,
  'ai.review_pi_model': {
    label: 'Agent deep review model',
    description:
      'Runs reviewer agents with `engine: pi`, which read the repository with tools. It must support tool calling. Follows the agent review model until set here.',
    group: 'AI models',
    schema: modelId,
    default: (env) => env.REVIEW_MODEL || '@cf/zai-org/glm-5.3',
    follows: 'ai.review_model',
  } satisfies Definition<string>,
  'review.allow_self_approval': {
    label: 'Authors approve their own pull requests',
    description:
      "Off: someone other than a pull request's author approves it and decides the findings on it that need a person (approving, dismissing a change request), on the web, through MCP and by Let Claude decide. On: the author may too, as on an instance with one maintainer.",
    group: 'Reviews',
    schema: z.boolean(),
    default: () => false,
  } satisfies Definition<boolean>,
  'review.pi_minutes': {
    label: 'Deep review time limit (minutes)',
    description: `How long an engine: pi review may run before it fails (Retry runs it again). From 5 to ${PI_MAX_MINUTES} minutes.`,
    group: 'Reviews',
    schema: whole(5, PI_MAX_MINUTES),
    default: () => 30,
  } satisfies Definition<number>,
  'review.pi_max_tool_calls': {
    label: 'Deep review tool calls',
    description:
      'File reads and searches one engine: pi review may make; past them it is told to answer with what it has. From 5 to 500.',
    group: 'Reviews',
    schema: whole(5, 500),
    default: () => 60,
  } satisfies Definition<number>,
  'review.pi_max_model_calls': {
    label: 'Deep review model calls',
    description:
      'Model calls one engine: pi review may make before it is stopped and fails. From 5 to 500.',
    group: 'Reviews',
    schema: whole(5, 500),
    default: () => 80,
  } satisfies Definition<number>,
  'review.pi_max_input_tokens': {
    label: 'Deep review input tokens',
    description:
      'Input tokens, summed over the whole review, before an engine: pi review is stopped and fails. From 100,000 to 50,000,000.',
    group: 'Reviews',
    schema: whole(100_000, 50_000_000),
    default: () => 4_000_000,
  } satisfies Definition<number>,
  'review.learning': {
    label: 'Agents learn from dismissed findings',
    description:
      'When a pull request closes, each reviewer agent whose change requests people dismissed (or whose findings they decided with a teach note) edits its own AGENT.md and knowledge/ from them, committed to its repository and used by its next reviews. Off: agents change only when someone edits their repository; lessons already queued wait.',
    group: 'Reviews',
    schema: z.boolean(),
    default: () => true,
  } satisfies Definition<boolean>,
  'review.learn_minutes': {
    label: 'Learning time limit (minutes)',
    description: `How long one lesson (an agent learning from change requests people dismissed) may run before it fails; the daily sweep tries a failed lesson once more. From 2 to ${LEARN_MAX_MINUTES} minutes.`,
    group: 'Reviews',
    schema: whole(2, LEARN_MAX_MINUTES),
    default: () => 10,
  } satisfies Definition<number>,
  'review.learn_max_tool_calls': {
    label: 'Learning tool calls',
    description:
      'File reads, searches and edits one lesson may make; past them it is told to finish. From 5 to 200.',
    group: 'Reviews',
    schema: whole(5, 200),
    default: () => 30,
  } satisfies Definition<number>,
  'review.learn_max_model_calls': {
    label: 'Learning model calls',
    description:
      'Model calls one lesson may make before it is stopped and fails. From 5 to 200.',
    group: 'Reviews',
    schema: whole(5, 200),
    default: () => 30,
  } satisfies Definition<number>,
  'review.learn_max_input_tokens': {
    label: 'Learning input tokens',
    description:
      'Input tokens, summed over the whole lesson, before it is stopped and fails. From 100,000 to 10,000,000.',
    group: 'Reviews',
    schema: whole(100_000, 10_000_000),
    default: () => 1_000_000,
  } satisfies Definition<number>,
  'actions.retention_days': {
    label: 'Keep Actions runs for',
    description:
      'Finished workflow runs, with their jobs, steps, and logs, are deleted this many days after they finish, and agent runs this many days after they start. Empty keeps them forever.',
    group: 'Actions',
    schema: z.number().int().min(1).max(400).nullable(),
    default: () => 90,
  } satisfies Definition<number | null>,
  'actions.max_concurrent_jobs': {
    label: 'Jobs running at once',
    description:
      'The most Actions jobs that run at the same time across the instance, each in its own container. Jobs past the limit wait in a queue, first come first served, and the run page shows how many are ahead.',
    group: 'Actions',
    schema: z.number().int().min(1).max(500),
    default: () => 10,
  } satisfies Definition<number>,
  'actions.max_concurrent_jobs_per_repo': {
    label: 'Jobs running at once per repository',
    description:
      "The most Actions jobs of one repository that run at the same time, within the instance's limit, so one busy repository can't hold every slot while others wait. Empty: only the instance's limit applies.",
    group: 'Actions',
    schema: z.number().int().min(1).max(500).nullable(),
    default: () => null,
  } satisfies Definition<number | null>,
  'actions.max_runner_size': {
    label: 'Largest runner',
    description:
      'The largest container a job may ask for with runs-on (cloudforge-standard-N). A workflow whose job asks for a larger one is invalid and does not run; ubuntu-latest is standard-2.',
    group: 'Actions',
    schema: z.enum(SIZES),
    default: () => 'standard-4' as InstanceType,
  } satisfies Definition<InstanceType>,
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = ReturnType<
  (typeof SETTINGS)[K]['default']
>;

export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

/** A setting's value from the stored rows: its saved value, else what it follows, else its default. */
function resolve(
  key: SettingKey,
  rows: { key: string; value: unknown }[],
  env: CloudflareBindings
): { value: unknown; overridden: boolean; fallback: unknown } {
  const def: Definition<unknown> = SETTINGS[key];
  const row = rows.find((r) => r.key === key);
  // A stored value that no longer validates (the rules changed) falls back to the default.
  const parsed = row ? def.schema.safeParse(row.value) : null;
  const fallback =
    def.follows && isSettingKey(def.follows)
      ? resolve(def.follows, rows, env).value
      : def.default(env);
  return {
    value: parsed?.success ? parsed.data : fallback,
    overridden: Boolean(parsed?.success),
    fallback,
  };
}

/** Several settings in one query, each falling back to its default. */
export async function getSettings<K extends SettingKey>(
  db: DrizzleDB,
  env: CloudflareBindings,
  keys: K[]
): Promise<{ [P in K]: SettingValue<P> }> {
  const wanted: string[] = [...keys];
  for (const key of keys) {
    const f = (SETTINGS[key] as Definition<unknown>).follows;
    if (f) wanted.push(f);
  }
  const rows = keys.length
    ? await db
        .select()
        .from(instanceSettings)
        .where(inArray(instanceSettings.key, wanted))
        .all()
    : [];
  const out = {} as { [P in K]: SettingValue<P> };
  for (const key of keys)
    out[key] = resolve(key, rows, env).value as SettingValue<K>;
  return out;
}

export async function getSetting<K extends SettingKey>(
  db: DrizzleDB,
  env: CloudflareBindings,
  key: K
): Promise<SettingValue<K>> {
  return (await getSettings(db, env, [key]))[key];
}

/**
 * Saves a setting, or with `value === undefined` resets it to its default. Throws a ZodError
 * when the value doesn't validate.
 */
export async function setSetting(
  db: DrizzleDB,
  key: SettingKey,
  value: unknown,
  userId: string
) {
  if (value === undefined) {
    await db.delete(instanceSettings).where(eq(instanceSettings.key, key));
    return;
  }
  const parsed = (SETTINGS[key].schema as z.ZodType).parse(value);
  const row = {
    key,
    value: parsed,
    updatedById: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(instanceSettings)
    .values(row)
    .onConflictDoUpdate({
      target: instanceSettings.key,
      set: { value: parsed, updatedById: userId, updatedAt: row.updatedAt },
    });
}

/** Every setting with its current value, default, and whether it was changed, for Site admin. */
export async function listSettings(db: DrizzleDB, env: CloudflareBindings) {
  const rows = await db.select().from(instanceSettings).all();
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const def: Definition<unknown> = SETTINGS[key];
    const row = rows.find((r) => r.key === key);
    const r = resolve(key, rows, env);
    return {
      key,
      label: def.label,
      description: def.description,
      group: def.group,
      value: r.value,
      default: r.fallback,
      overridden: r.overridden,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      ...inputOf(def),
      ...bounds(def.schema),
    };
  });
}

/**
 * Which control Site admin shows: a switch, a choice among `options`, a number, or text (`optional` text may be
 * saved empty).
 */
function inputOf(def: Definition<unknown>): {
  input: 'boolean' | 'choice' | 'number' | 'text';
  options?: { value: string; label: string }[];
  optional?: boolean;
} {
  const schema = def.schema;
  if (schema instanceof z.ZodBoolean) return { input: 'boolean' };
  if (schema instanceof z.ZodEnum)
    return {
      input: 'choice',
      options: (schema.options as string[]).map((value) => ({
        value,
        label: def.choices?.[value] ?? value,
      })),
    };
  const inner = schema instanceof z.ZodNullable ? schema.unwrap() : schema;
  if (inner instanceof z.ZodNumber) return { input: 'number' };
  return { input: 'text', optional: def.default({} as never) === '' };
}

/** A number setting's inclusive limits, for the Site admin input. */
function bounds(schema: z.ZodType): { min?: number; max?: number } {
  if (!(schema instanceof z.ZodNumber)) return {};
  const { minValue, maxValue } = schema;
  return {
    ...(Number.isFinite(minValue) && { min: minValue as number }),
    ...(Number.isFinite(maxValue) && { max: maxValue as number }),
  };
}

/** The instance's display name: Site admin's setting, else `APP_NAME`, else "CloudForge". */
export const instanceName = (db: DrizzleDB, env: CloudflareBindings) =>
  getSetting(db, env, 'app.name');

// Internal state kept beside the settings (not shown in Site admin as an editable setting).
export const RETENTION_STATUS_KEY = 'actions.retention_status';
