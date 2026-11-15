# Bindings, Env Vars & Instance Settings

CloudForge separates deploy-time infrastructure bindings (`wrangler.jsonc`), sensitive secrets (`wrangler secret` / `.dev.vars`), and runtime instance settings persisted in D1 `instance_settings` (**Site admin → Settings**).

## 1. Wrangler Bindings & Cron Triggers

| Binding / Key                            | Type                                 | Role                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB`                                     | D1 Database                          | Primary relational store for accounts, repos, PRs, issues, actions state, webhooks, and audit                                                                    |
| `ARTIFACTS`                              | Artifacts Namespace                  | Git objects and refs storage (1 GB/repo limit, Git protocol v1)                                                                                                  |
| `LFS` / `ACTIONS_LOGS` / `ACTIONS_CACHE` | R2 Buckets                           | Git LFS blobs, step log chunks, and Actions cache objects                                                                                                        |
| `ACTIONS_RUN`                            | Workflow (`ActionsRun`)              | Orchestrates `.github/workflows/*.yml` DAG execution                                                                                                             |
| `MERGE_RESOLUTION`                       | Workflow (`MergeResolutionWorkflow`) | Orchestrates AI reviews, conflict resolution, PR stacking, conflict sweeps, and `agent_lessons`                                                                  |
| `JOB_RUNNER`                             | Durable Object + Container           | Executes Actions container steps (`cloudforge-standard-1`..`4`)                                                                                                  |
| `ACTIONS_QUEUE`                          | Durable Object (`ActionsQueue`)      | Enforces instance-wide and per-repo concurrent job caps                                                                                                          |
| `AGENT_REVIEWER`                         | Durable Object (`AgentReviewer`)     | Provides isolated `/repo` & `/agent` workspaces for `engine: pi` reviews and learning                                                                            |
| `MERGE_RESOLVER` / `LIVE_HUB`            | Durable Objects                      | Conflict resolver DO and browser WebSocket refresh hub (`/api/live`)                                                                                             |
| `AI` / `EMAIL`                           | Workers AI / SendEmail               | Model inference and invitation/verification/notification emails                                                                                                  |
| `triggers.crons`                         | 3 Cron expressions                   | `*/5 * * * *` (Webhook retries, 24h email fallback, OIDC cleanup), `30 2 * * *` (usage analytics sync), `17 4 * * *` (retention cleanup & lesson/close recovery) |

## 2. Plain Vars & Secrets

| Key                                                 | Secret?          | Description                                                                                |
| --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `BASE_URL`                                          | Var              | Public instance origin controlling `__Secure-` cookie prefix, OAuth issuer, and email URLs |
| `APP_NAME` / `FROM_EMAIL`                           | Var              | Fallback display name and sender address                                                   |
| `SUMMARY_MODEL` / `REVIEW_MODEL` / `RESOLVER_MODEL` | Var              | Default Workers AI models (GLM-5.3 / GLM-5.3-Flash)                                        |
| `AI_GATEWAY_ID` / `CLOUDFLARE_ACCOUNT_ID`           | Var              | AI Gateway and Cloudflare account identifiers                                              |
| `BETTER_AUTH_SECRET`                                | **Secret**       | High-entropy secret (32+ bytes) for session/OAuth HMAC signing                             |
| `SECRETS_ENCRYPTION_KEY`                            | **Secret**       | 32-byte base64 AES-GCM key sealing Actions secrets and Webhook secrets                     |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`         | **Secret**       | S3 credentials for 15-minute R2 presigned Git LFS & cache URLs                             |
| `CLOUDFLARE_API_TOKEN`                              | **Secret**       | Scoped token for daily GraphQL usage analytics polling                                     |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`       | Var / **Secret** | Optional Cloudflare Turnstile CAPTCHA credentials                                          |

## 3. Dynamic Runtime Settings (`SETTINGS` in `worker/src/instance/settings.ts`)

Site admins can adjust and reset `app.name`, `ui.default_language` (`auto` | `zh` | `en`), `email.from`, self-signup toggles (`signup.enabled`, `signup.allowed_domains`, `signup.require_verification`), AI models (`ai.*`), review limits (`review.allow_self_approval` default `false`, `review.pi_*`, `review.learning`, `review.learn_*`), and Actions retention/quotas (`actions.retention_days` default `90`, `actions.max_concurrent_jobs` default `10`, `actions.max_concurrent_jobs_per_repo`, `actions.max_runner_size` default `standard-4`) directly in Site admin without redeploying.
