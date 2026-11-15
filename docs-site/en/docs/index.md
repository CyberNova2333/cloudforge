# Stage 1: Overview & Scope Boundaries

CloudForge is a **single-tenant, self-hosted Git and code review platform deployed inside your own Cloudflare account**, forked from [choyiny/gitorange](https://github.com/choyiny/gitorange) (forked 2026-10-22; upstream Apache-2.0, derivative licensed under AGPL-3.0-only).

Instead of running VMs or external database clusters, one Cloudflare Worker serves the React 18 SPA, OpenAPI REST routes, Git Smart HTTP, Git LFS Batch API, and an OAuth 2.1 `/mcp` server from the same origin. Repository metadata and workflow state live in **D1**; Git objects and refs live in **Cloudflare Artifacts**; LFS blobs, Actions logs, and caches live in **R2**; CI jobs run in **Cloudflare Containers**; and review/resolution pipelines use **Workers AI** and **AI Gateway**.

## Positioning & Non-Goals

- **One instance, one organization**: Members share one site and up to one shared team namespace. Designed for small teams, labs, or personal self-hosting—**not multi-tenant SaaS**.
- **AI-assisted review & safe landing**: Invited reviewer agents (each backed by an internal `<handle>/<handle>` repo with `AGENT.md`) review every PR head commit, while `MERGE_RESOLUTION` handles DAG stacking and `landPull` executes CAS rebase + fast-forward merges.
- **Native coding agent integration**: RFC 8414 / 9728 / 7591 OAuth 2.1 and stateless Streamable HTTP `/mcp` allow external coding agents to pick up issues, file PRs with session provenance, and inspect run logs.

## Platform Hard Limits

| Area                   | Current Constraint                                                     | Practical Guidance                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git Transport**      | **No SSH** (Workers cannot listen on port 22)                          | Use HTTPS with Personal Access Tokens (PATs) or scoped Deploy Tokens (`cfd_`)                                                                                                                              |
| **Artifacts Quota**    | **1 GB** per newly created Artifacts repository; Git protocol v1       | Store large binaries in built-in **Git LFS** (backed by R2 presigned URLs)                                                                                                                                 |
| **D1 Bounds**          | Single-threaded SQLite; max **100 bound parameters** per SQL statement | High-volume writes batch via `json_each` / chunking and background recovery                                                                                                                                |
| **Explicit Non-Goals** | Out of scope in the current release                                    | Issue milestones/templates, cross-repo `owner/repo#N`, per-branch Webhook filters, multiple concurrent OIDC providers, Passkeys, SSH deploy keys, public cross-repo forks, and full instance bundle export |

::: tip Next Steps
Proceed to [Deployment Modes & Operations](/en/docs/deployment) and [Bindings, Vars & Instance Settings](/en/docs/configuration).
:::
