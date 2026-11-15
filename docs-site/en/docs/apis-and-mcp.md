# REST API, OAuth 2.1 MCP, Webhooks, LFS & Actions Contracts

## 1. OpenAPI & Live Discovery

Signed-in members can inspect the live Zod OpenAPI 3.0 spec and Swagger UI:

- `GET /api/doc` & `GET /api/swagger-ui` (CloudForge routes)
- `GET /api/auth/reference` & `/api/auth/open-api/*` (`better-auth` routes)
- `GET/HEAD /.well-known/cloudforge` (unauthenticated, no-store runtime health & `accessRuntime.ready` metadata)
- `GET /api/live` (authenticated WebSocket relaying lightweight `repo:<id>`, `user:<id>`, and `approvals` invalidation pings)

## 2. Stateless Streamable HTTP `/mcp` & OAuth 2.1

`POST /mcp` implements JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`, `tools/call`; `GET`/`DELETE` return `405`) backed by RFC 9728 (`/.well-known/oauth-protected-resource/mcp`), RFC 8414 (`/.well-known/oauth-authorization-server[/api/auth]`), and RFC 7591 dynamic registration (`/api/auth/oauth2/register`, defaulting loopback/app-scheme clients to `native`).

- **31 Standard Tools**: Repositories & usage (`cloudforge_list_repositories`, `get_repository`, `get_repository_insights`, `create_repository`, `get_usage`), Pulls & Actions (`list_pull_requests`, `get_pull_tree`, `get_pull_request`, `create_pull_request`, `comment_pull_request`, `merge_pull_request`, `retry_rebase`, `rerun_checks`, `get_run_logs`, `request_changes_on_review_flag`), Issues (`list_issues`, `get_issue`, `create_issue`, `update_issue`, `comment_issue`), Releases (`list_releases`, `create_release`), Notifications (`list_notifications`, `mark_notifications_read`), Commit Statuses (`create_commit_status`, `get_commit_status`), Agents (`list_agents`, `list_repository_agents`, `invite_agent`, `remove_agent`, `create_agent`).
- **3 Moderator Tools (`mcp_moderators`)**: `cloudforge_approve_review_finding`, `cloudforge_dismiss_change_request`, and `cloudforge_approve_pull_request` are hidden and blocked unless the user explicitly promotes that OAuth client in **Settings → MCP server** (forcing `prompt=consent` on every authorization and checking the locked head SHA on execution). Incoming legacy `gitorange_*` calls map transparently while `tools/list` advertises `cloudforge_*` only.

## 3. Commit Statuses, Webhooks, Actions & Git LFS

- **Commit Statuses**: `POST /api/repos/{owner}/{repo}/statuses/{sha}` (push permission, PAT allowed, max 1000/commit, 140-char description) joins Actions runs inside `review/checks.ts` to gate merging and trigger auto-merge on `success`.
- **Webhooks**: Up to 20/repo across `push`, `pull_request`, `issues`, `issue_comment`, `release`, `status`, and `ping`. Signed with `X-Hub-Signature-256` (`AES-GCM` sealed secrets in D1), sending both `X-CloudForge-*` and `X-GitHub-*` headers, 10s timeout, no redirects, 2048-byte response cap, and 5 attempts (1m / 5m / 30m / 2h) via the 5-minute cron.
- **GitHub-Compatible Actions**: Supports `on: push` (with `tags:`), `pull_request`, `workflow_dispatch`, expressions, `GITHUB_EVENT_PATH`, container labels `ubuntu-latest` (`standard-2`) and `cloudforge-standard-1`..`4`, plus `cloudforge/relevance@v1` test pruning.
- **Git LFS**: `/<owner>/<repo>.git/info/lfs/...` Batch API (`basic` adapter) issuing 15-minute R2 presigned URLs verified with `x-amz-checksum-sha256`; locking endpoints return empty/`501`.
