# Actions Containers, Commit Statuses & Webhooks

Built-in CI and external CI systems converge on the same merge gate (`worker/src/review/checks.ts`).

- **Container Workflows (`ActionsRun`, `ActionsQueue`, `JobRunner`)**: Workflows parse via `worker/src/actions/workflow-file.ts`, queue behind instance-wide (`actions.max_concurrent_jobs`, default 10) and per-repo concurrency caps (`worker/src/actions/queue.ts`), stream logs to `ACTIONS_LOGS`, mask repository and allowlisted instance secrets (`worker/src/actions/secrets.ts`), and support `cloudforge/relevance@v1` module filtering (`worker/src/actions/relevance.ts`).
- **External Commit Statuses & Webhooks**: External CI systems post commit statuses using Bearer/token PATs (`worker/src/repositories/commit-statuses.ts`). Repository admins configure up to 20 webhooks (`worker/src/webhooks/service.ts`) signed with `X-Hub-Signature-256`; delivery blocks `localhost`/`.local`/`.internal`/private IP literals, rejects 3xx redirects, caps response streaming at 2048 bytes, and retries up to 5 times (1m/5m/30m/2h) via the 5-minute cron (`worker/src/cron.ts`).

Next: [Auth, OIDC & Access Runtime](/en/docs/modules/auth-oidc-and-access).
