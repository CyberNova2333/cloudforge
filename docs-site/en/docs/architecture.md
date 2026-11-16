# System Architecture & Interactive Topology

CloudForge separates edge request routing, SQL state, Git pack storage, and container execution across six complementary Cloudflare planes without running persistent VMs.

## Interactive System Diagram (Archify)

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📐</span> CloudForge Architecture & Data Flow Diagram
    </span>
    <a href="/diagrams/cloudforge-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      Open Fullscreen ↗
    </a>
  </div>
  <iframe src="/diagrams/cloudforge-architecture.html" width="100%" height="560px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

## Runtime Planes

1. **Unified Edge Gateway & React 18 SPA (`worker/src/index.ts`, `src/`)**: Enforces `accessRuntimeResponse`, body limits (`64 KB` / `1 MB`), and routes Smart HTTP Git, Git LFS, OAuth 2.1 `/mcp`, OpenAPI `/api/*`, and static SPA assets from one origin.
2. **D1 Relational State (`migrations/0000`–`0066`, `worker/src/db/`)**: Stores users, sessions, repositories, PR/stack edges, issues, notifications, webhooks, runs, and `push_events` outbox rows using batched queries respecting D1's 100-parameter SQL limit.
3. **Cloudflare Artifacts & R2 Object Plane**: Delegates Git objects/refs to per-repo `ARTIFACTS` namespaces (1 GB limit, Git v1) while storing LFS binaries, Actions logs, and caches in R2 buckets (`LFS`, `ACTIONS_LOGS`, `ACTIONS_CACHE`).
4. **Durable Orchestration Plane**: Runs `ActionsRun` + `ActionsQueue` + `JobRunner` Containers for CI; `MergeResolutionWorkflow` + `AgentReviewer` + `MergeResolver` for AI review, DAG stacking, conflict resolution, and self-learning; and `LiveHub` for browser WebSocket pings.
5. **Workers AI, AI Gateway & Email Sending**: Supplies summary, review, deep Pi, and conflict resolver GLM models (tagging untrusted code blocks) plus invitation, verification, and notification emails.

::: tip Continue Exploring
Read [End-to-End Walkthrough](/en/docs/walkthrough), the four [Module Deep Dives](/en/docs/modules/git-and-storage), and [Code Map & Contributing](/en/docs/code-map).
:::
