# System Architecture & Interactive Topology

CloudForge separates edge request routing, SQL state, Git pack storage, and container execution across six complementary Cloudflare planes without running persistent VMs.

## Interactive System Diagram (Archify)

<DiagramFrame
  src="/diagrams/cloudforge-architecture.html"
  title="CloudForge Architecture & Data Flow Diagram"
  aspect="890 / 448"
  new-tab-label="Open Fullscreen ↗"
/>

## Runtime Planes

1. **Unified Edge Gateway & React 18 SPA (`worker/src/index.ts`, `src/`)**: Enforces `accessRuntimeResponse`, body limits (`64 KB` / `1 MB`), and routes Smart HTTP Git, Git LFS, OAuth 2.1 `/mcp`, OpenAPI `/api/*`, and static SPA assets from one origin.
2. **D1 Relational State (`migrations/0000`–`0066`, `worker/src/db/`)**: Stores users, sessions, repositories, PR/stack edges, issues, notifications, webhooks, runs, and `push_events` outbox rows using batched queries respecting D1's 100-parameter SQL limit.
3. **Cloudflare Artifacts & R2 Object Plane**: Delegates Git objects/refs to per-repo `ARTIFACTS` namespaces (1 GB limit, Git v1) while storing LFS binaries, Actions logs, and caches in R2 buckets (`LFS`, `ACTIONS_LOGS`, `ACTIONS_CACHE`).
4. **Durable Orchestration Plane**: Runs `ActionsRun` + `ActionsQueue` + `JobRunner` Containers for CI; `MergeResolutionWorkflow` + `AgentReviewer` + `MergeResolver` for AI review, DAG stacking, conflict resolution, and self-learning; and `LiveHub` for browser WebSocket pings.
5. **Workers AI, AI Gateway & Email Sending**: Supplies summary, review, deep Pi, and conflict resolver GLM models (tagging untrusted code blocks) plus invitation, verification, and notification emails.

::: tip Continue Exploring
Read [End-to-End Walkthrough](/en/docs/walkthrough), the four [Module Deep Dives](/en/docs/modules/git-and-storage), and [Code Map & Contributing](/en/docs/code-map).
:::
