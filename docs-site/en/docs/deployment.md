# Deployment Modes & Operations

You can deploy CloudForge via the zero-clone npm installer CLI, from a local clone with `pnpm cloudforge`, via manual `wrangler.jsonc` commands, or locally using `pnpm dev`.

## 1. Official Installer CLI (Recommended)

The CLI in `scripts/cloudforge/` (published as `@cybernova2333/cloudforge`) inspects Cloudflare credentials, provisions D1, R2 buckets, and Artifacts namespaces, applies all 67 D1 migrations in `migrations/`, deploys the Worker, and keeps local installation state outside your repository.

```bash
# Fresh production install into your own Cloudflare account
pnpm dlx @cybernova2333/cloudforge install

# Equivalent inside a cloned repository
pnpm cloudforge install
```

Visit your instance root after deploy to complete first-run setup at `/setup` and review **Site admin → Setup**.

### Operations & Recovery Subcommands

| Command                                             | Purpose                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm dlx @cybernova2333/cloudforge status`         | Show tracked installation metadata, Worker status, and D1 migration state                     |
| `pnpm dlx @cybernova2333/cloudforge upgrade`        | Verify schema/trigger preflight, run pending D1 migrations, and deploy updated Worker         |
| `pnpm dlx @cybernova2333/cloudforge adopt`          | Adopt an existing manually deployed instance into CLI management                              |
| `pnpm dlx @cybernova2333/cloudforge reset-password` | Offline password reset and session revocation (requires explicit target & confirmation)       |
| `pnpm dlx @cybernova2333/cloudforge reset-mfa`      | Offline TOTP & recovery-code reset without relaxing instance MFA policy                       |
| `pnpm cloudforge access-preflight`                  | Read-only check of D1 schema state (`legacy` / `compat-v1` / `runtime-bridge-v1`)             |
| `pnpm cloudforge access-drain-status`               | Read-only inspection of in-flight D1 tasks across Actions, Runners, Agents, and `push_events` |

::: info Fresh Releases
Append `--prefer-online` to `pnpm dlx` right after publishing a new package version, and pass `--name <instance>` when managing multiple instances.
:::

## 2. Manual `wrangler.jsonc` & Token Permissions

Copy `wrangler.jsonc.example` to `wrangler.jsonc`, create the D1 database, three R2 buckets, and Artifacts namespace, then run:

```bash
pnpm build
pnpm exec wrangler d1 migrations apply <your-d1-db> --remote
pnpm exec wrangler deploy
```

Any `CLOUDFLARE_API_TOKEN` used by the installer or CI must include account scopes documented in `docs/setup.md`: Workers Scripts (Edit), Workers Tail (Read), R2 Storage (Edit), D1 (Edit), Containers (Edit), Workers AI (Read), Cloudflare Artifacts (Edit), AI Gateway (as needed), Workers Observability/Analytics (Read for usage metrics), plus Zone DNS/Workers Routes and Email Sending when configuring custom domains and email delivery.

## 3. Local Development (`pnpm dev`)

```bash
pnpm install --frozen-lockfile
cp wrangler.jsonc.example wrangler.jsonc
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev             # Starts Vite + local workerd at http://localhost:8080
pnpm seed:demo       # Optional: seeds sample PRs, stacks, review findings, and runs
```
