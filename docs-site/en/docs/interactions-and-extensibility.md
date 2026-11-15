# Cross-Module Flows, `AGENT.md` Authoring & UI i18n

## 1. End-to-End Push-to-Landing Coordination

1. **Receive & Persist**: Git Smart HTTP passes `access_runtime_state` and `decidePush` ref protection, forwards objects to Cloudflare Artifacts, and persists `push_events` in D1 _before_ acknowledging the client so background failures can resume via lease recovery.
2. **Parallel Fan-Out**: `push_events` refreshes `AGENT.md` config if the pushed branch belongs to an agent repository, updates open PRs, triggers `ActionsRun` workflows (preserving `before` SHA), and queues Webhook deliveries.
3. **Review, Stacking & Gate**: Invited agents run `engine: pass` or `AgentReviewer` (`engine: pi`), followed by `MERGE_RESOLUTION` DAG stacking (`git` lineage first, then AI + `acyclicVerdict` into `pr_edges`) and D1-only `base_ref` retargeting while keeping `land_target`. Every merge path (button, MCP, auto-merge) passes through `landPull`: pause check → `stackGate` + `carriedPull` → `checksAt` → `reviewVerdict` → target CAS fast-forward.
4. **Checkpointed Post-Merge Follow-ups**: `landing-recovery.ts` deletes merged head branches, closes referenced `Fixes #N` issues on default-branch landings, sends inbox/email notifications, triggers `push` Webhooks, and enqueues `agent_lessons` when change requests were dismissed or taught.

## 2. Authoring Reviewer Agents (`AGENT.md`)

Site admins create agents via **Site admin → Agents**, provisioning `<handle>/<handle>` with `AGENT.md` YAML frontmatter:

- `engine`: `pass` (single pass via `ai.review_model`) or `pi` (sandboxed tool loop inside `AgentReviewer` DO using `ai.review_pi_model`).
- `guarded: true` or `facet: security|data`: requires explicit human rationale on dismissal (HTTP 422 otherwise) and blocks automated `Let Claude decide` delegation (`ai_delegations`).
- **Self-Learning**: Closed PRs with dismissed change requests or teach notes queue one lesson per `(agent, pull)`; the agent may edit only `AGENT.md` body and `knowledge/**` (frontmatter bytes must remain untouched) under `review.learn_*` budgets.

## 3. UI Internationalization (`src/lib/i18n.ts` & `src/locales/zh/`)

English literal strings serve directly as translation keys (`t('Save changes')`, `tn(...)`, `tx(...)`). Resolution order follows: **User Preferences** (`/api/me/preferences`) → **Local Toggle** → **Instance Default** (`ui.default_language`) → **Browser Language** (`zh*` -> Chinese, else English). Validate keys and placeholders with:

```bash
node scripts/i18n/i18n-strings.mjs src/pages/overview/Home.tsx
node scripts/i18n/i18n-missing.mjs src/pages/overview/Home.tsx
```
