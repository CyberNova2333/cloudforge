---
layout: home

hero:
  name: CloudForge
  text: Self-Hosted Git & AI Review on Cloudflare
  tagline: 'Single-tenant code platform in your own Cloudflare account: Worker API & SPA, Artifacts Git, R2 LFS, Container Actions, Stacked PRs, and OAuth 2.1 MCP.'
  actions:
    - theme: brand
      text: Deploy & Configure
      link: /en/docs/
    - theme: alt
      text: Architecture Diagram
      link: /en/docs/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/CyberNova2333/cloudforge

features:
  - title: Edge Git with Artifacts & R2 LFS
    details: Git objects live in Cloudflare Artifacts while large binaries upload directly to R2 via 15-minute presigned URLs after Worker permission checks.
  - title: AI Reviewers, Stacking & Auto-Merge
    details: 'Single-pass and sandboxed AgentReviewer (engine: pi) reviews feed a unified reviewVerdict gate, DAG PR stacking without pushing user branches, and CAS fast-forward landing.'
  - title: Container Actions & OAuth 2.1 MCP
    details: GitHub-compatible YAML workflows run in Cloudflare Containers alongside a stateless Streamable HTTP /mcp server with explicit moderator approval controls.
---

## Architecture Overview

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📐</span> CloudForge Edge & Control-Plane Architecture (Interactive Archify diagram: pan, zoom, inspect)
    </span>
    <a href="/diagrams/cloudforge-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      Open Fullscreen ↗
    </a>
  </div>
  <iframe src="/diagrams/cloudforge-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

## Fastest Runnable Path

```bash
# Provision or upgrade CloudForge in your own Cloudflare account
pnpm dlx @cybernova2333/cloudforge install

# Or run the full local development stack at http://localhost:8080
pnpm install --frozen-lockfile && pnpm dev
```

## Documentation Guide

::: tip Quick Navigation by Role & Goal

- **Evaluate fit & deploy an instance**: Start with [Overview & Boundaries](/en/docs/) and [Deployment Modes](/en/docs/deployment) for single-tenant limits, Cloudflare API token scopes, and installer CLI / manual setup;
- **Configure bindings & troubleshoot**: See [Configuration Matrix](/en/docs/configuration) and [FAQ](/en/docs/faq) for Wrangler bindings, cron schedules, secrets, and `reset-mfa` / 503 diagnostics;
- **Integrate MCP, Webhooks, CI or Agents**: Read [API, MCP & Webhooks](/en/docs/apis-and-mcp) and [Flows & AGENT.md](/en/docs/interactions-and-extensibility) for 31+3 MCP tools, HMAC webhooks, and `AGENT.md` authoring;
- **Trace source internals & upgrade D1 schema**: Explore [Architecture](/en/docs/architecture), [Walkthrough](/en/docs/walkthrough), [Code Map](/en/docs/code-map), and [Migrations & ADRs](/en/docs/changelog-and-migrations).
  :::
