# Code Map & Contributor Verification Workflow

See the full Chinese directory-by-directory map in `repo-docs/code-map.md` and evidence ledger in `repo-docs/references/source-evidence.md`. Below is the structural summary for contributors.

## Domain Directory Layout

| Area                           | Path                                                                                                                                                       | Responsibility                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Worker Entry & Cron**        | `worker/src/index.ts`, `worker/src/cron.ts`                                                                                                                | Hono OpenAPI gateway, Git/LFS dispatch, Workflow/DO exports, cron schedules (`*/5 * * * *`, `30 2 * * *`, `17 4 * * *`)                |
| **Git & LFS**                  | `worker/src/git/`, `worker/src/lfs/`                                                                                                                       | Smart HTTP, pack/pktline, `decidePush`, `push_events` outbox, R2 presigned Batch API                                                   |
| **Reviews, Agents & Learning** | `worker/src/review/`, `worker/src/agents/`, `worker/src/learn/`                                                                                            | `reviewVerdict`, `AgentReviewer` DO (`engine: pi`), `AGENT.md` sync, `agent_lessons` feedback loop                                     |
| **Stacking & Merge**           | `worker/src/stack/`, `worker/src/merge/`, `worker/src/pulls/`, `worker/src/releases/`                                                                      | DAG lineage & `reconcile`, `landPull` CAS rebase+FF, `landing-recovery`, `close-recovery`, `vX.Y.Z` releases                           |
| **Actions CI**                 | `worker/src/actions/`                                                                                                                                      | YAML parser, `ActionsRun`, `JobRunner` Containers, `ActionsQueue`, `secrets`, `cloudforge/relevance@v1`                                |
| **Collaboration & Auth**       | `worker/src/issues/`, `worker/src/notifications/`, `worker/src/webhooks/`, `worker/src/auth/`, `worker/src/oidc/`, `worker/src/access/`, `worker/src/mcp/` | Shared `#N` issues, mention inbox/emails, HMAC webhooks, D1 session & MFA policies, OIDC SSO, `access_runtime_state`, OAuth 2.1 `/mcp` |
| **Frontend SPA**               | `src/`                                                                                                                                                     | React 18, Primer CSS, TanStack Query, `src/locales/zh/` i18n dictionaries                                                              |
| **Tooling & DB**               | `scripts/cloudforge/`, `scripts/database/`, `scripts/githooks/`, `scripts/agents/`, `migrations/`                                                          | Installer CLI (`@cybernova2333/cloudforge`), Drizzle migration generator (67 SQL files), Chinese commit/hook rules                     |

## Contributor Verification Commands

Every backend test belongs in `worker/src/__tests__/<domain>/` and must be registered in `.github/workflows/ci.yml` (enforced by `ci-workflow.test.ts`):

```bash
pnpm typecheck
pnpm test                 # Runs Node Vitest (scripts/cloudforge/vitest.config.ts) then workerd D1 tests
pnpm agents:sync --check  # Verifies CLAUDE.md and .agents/skills/ stay synced with AGENTS.md
pnpm format:check         # Checks Prettier rules matching .husky/pre-commit lint-staged
```

Commits must use Chinese Conventional Commits subjects (e.g., `docs(docs): ...`), include a `文档:` body line, and carry a `Co-authored-by:` trailer (`scripts/githooks/rules.mjs`).
