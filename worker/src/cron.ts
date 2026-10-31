// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Scheduled jobs, dispatched on the cron expression that fired. Each expression must also be in
 * `triggers.crons` in every wrangler template; add a job by adding an entry here and there.
 */
import { drizzle } from 'drizzle-orm/d1';
import { runActionsRetention } from './actions/retention';
import { schema } from './db/schema';
import { syncUsageCron } from './usage/sync';
import { deliverDueWebhooks } from './lib/webhooks';
import { deliverNotificationEmails } from './lib/notification-email';
import { cleanupOidcSignIn } from './oidc/sign-in';

/** Usage & cost: pulls the previous days' Cloudflare analytics (02:30 UTC). */
export const USAGE_SYNC_CRON = '30 2 * * *';
/** Deletes Actions runs past their retention (04:17 UTC). */
export const ACTIONS_RETENTION_CRON = '17 4 * * *';
/** Every five minutes: webhook deliveries due for another try, and notification emails a request was cut off before. */
export const FREQUENT_CRON = '*/5 * * * *';

/** The frequent cron's work; each part runs even when the other fails. */
export async function runFrequentJobs(env: CloudflareBindings) {
  const db = drizzle(env.DB, { schema });
  await deliverDueWebhooks(env, db).catch((e: unknown) =>
    console.error('[cron] webhook retries failed', e)
  );
  await deliverNotificationEmails(env, db).catch((e: unknown) =>
    console.error('[cron] notification emails failed', e)
  );
  await cleanupOidcSignIn(env).catch((e: unknown) =>
    console.error('[cron] OIDC sign-in cleanup failed', e)
  );
}

export const CRON_JOBS: Record<
  string,
  (env: CloudflareBindings) => Promise<unknown>
> = {
  [USAGE_SYNC_CRON]: syncUsageCron,
  [ACTIONS_RETENTION_CRON]: (env) =>
    runActionsRetention(env, drizzle(env.DB, { schema })),
  [FREQUENT_CRON]: runFrequentJobs,
};

export async function runScheduled(
  controller: Pick<ScheduledController, 'cron'>,
  env: CloudflareBindings
) {
  const job = CRON_JOBS[controller.cron];
  if (!job) {
    console.warn('[cron] no job for', controller.cron);
    return;
  }
  await job(env);
}
