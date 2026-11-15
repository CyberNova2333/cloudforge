# Stage 4: D1 Migrations, Upgrade Gates & Key ADRs

## 1. D1 Migration Progression (`migrations/0000`–`0066`)

Schema changes are generated exclusively via Drizzle declarations (`worker/src/db/*.schema.ts`) and `scripts/database/generate-db.mjs`:

- **`0000`–`0039`**: Core single-tenant tables (users, repos, collaborators, PRs, reviews, Actions runs, Artifacts tracking, OAuth clients).
- **`0040`–`0044`**: Security & reliability audit (per-repo instance secret allowlists, push protection, self-approval guards, landing recovery, per-repo Actions concurrency limits).
- **`0045`–`0048`**: Issues (`next_pr_number` shared counter), Notifications inbox & watches, Commit Statuses, Webhooks (`webhook_deliveries`), and Actions capacity indexes.
- **`0049`–`0061`**: TOTP 2FA, recovery codes, offline recovery logs, mandatory admin MFA policy, OIDC explicit linking, global OIDC kill-switch triggers, and `sso` session tracking.
- **`0062`–`0066`**: Authorization write triggers, release receipt tracking (`release.schema.ts`), and the access compatibility runtime bridge (`access_runtime_state`, `compat-v1` / `runtime-bridge-v1`).

## 2. Upgrade Gates & Pre-Flight Tools

```bash
pnpm dlx @cybernova2333/cloudforge status --name <instance>
pnpm cloudforge access-preflight --name <instance>
pnpm cloudforge access-drain-status --name <instance>
pnpm dlx @cybernova2333/cloudforge upgrade --name <instance>
```

- **Fail-closed schema verification**: `upgrade` checks target protocol, all 67 migration checksums, and managed trigger integrity before and during apply; anomalies block execution without guessing or overwriting data.
- **Observation scope**: `access-preflight` and `access-drain-status` inspect bounded D1 snapshots (up to 1000 records per category); `rolePublishingAllowed` and `rollbackSafe` always report `false`, and a zero exit code does **not** prove Durable Objects (subject to Cloudflare's ~300s deferred code updates) or running Workflows have drained.

## 3. Key Architecture Decision Records (ADRs)

| Decision                     | Chosen Design                                                                                     | Trade-off                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Git Object Store**         | Delegate pack/ref storage to `Cloudflare Artifacts` and binaries to R2 LFS                        | Eliminates custom pack indexing inside Workers, accepting the 1 GB Artifacts repo limit and Git v1 protocol.           |
| **Isolated Deep Reviews**    | Spawn one `AgentReviewer` DO per `engine: pi` attempt (`id:created_at`)                           | Prevents cross-attempt state leaks and context overflow; falls back gracefully to single-pass when unbound.            |
| **Non-Destructive Stacking** | Store `base_ref` and `land_target` separately in D1 (`reconcile`)                                 | Never rewrites or force-pushes developers' remote feature branches during stacking/unstacking.                         |
| **D1 Protocol Guard**        | Read `access_runtime_state` at HTTP/Git/LFS & background entrypoints                              | Prevents older Workers from corrupting future schema invariants; requires forward-only Worker deployments once bumped. |
| **Explicit MCP Moderators**  | Keep 3 approval tools invisible unless explicitly enabled in `mcp_moderators` with forced consent | Prevents coding agents from silently self-approving or bypassing human review gates.                                   |
