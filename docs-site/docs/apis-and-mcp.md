# HTTP API、MCP、Webhooks 与 Actions 契约

本页整理所有面向集成方与自动化的对外协议契约，字段范围均来自 Worker 路由、Zod OpenAPI Schema 与 MCP 注册清点。

## 1. OpenAPI REST 与 Swagger 文档

Worker 使用 `@hono/zod-openapi` 构建 `/api/*` 全套接口，并在运行中的实例上向**已登录成员**开放交互式规范与调试界面（未登录访问会返回 `401` 以防止向外部暴露路由清单）：

- `GET /api/doc` & `GET /api/swagger-ui`：CloudForge 业务 OpenAPI 3.0 规范与 Swagger UI
- `GET /api/auth/reference` & `/api/auth/open-api/*`：内置 `better-auth` 认证路由文档
- `GET/HEAD /.well-known/cloudforge`：无须登录的不缓存实例健康/运行时协议元数据探针（包含 `accessRuntime.ready`）
- `GET /api/live`：WebSocket 频道入口，仅转发无数据的变更通知（`repo:<id>`、`user:<id>`、`approvals`），浏览器收到后再经鉴权 API 重取列表

## 2. OAuth 2.1 与无状态 MCP 服务（`POST /mcp`）

`/mcp` 基于 Streamable HTTP 提供 JSON-RPC 2.0 工具服务（仅支持 `initialize`、`ping`、`tools/list`、`tools/call`，不支持 SSE 服务端流；`GET` / `DELETE` 返回 `405`）。自动发现遵循：

1. 无凭据访问 `POST /mcp` 返回 `401` 与 `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`（RFC 9728）；
2. 读取 `/.well-known/oauth-authorization-server[/api/auth]`（RFC 8414）；
3. 通过 `/api/auth/oauth2/register`（RFC 7591）完成动态客户端注册（仅含 loopback/app-scheme 的客户端可省略 `application_type` 并自动归类为 `native`）；
4. 走 S256 PKCE 授权与用户 `/oauth/consent` 同意，换取 audience 为 `<origin>/mcp` 的 JWT（1 小时有效）及 `offline_access` 刷新令牌。

### MCP 工具清点（31 个标准工具 + 3 个 Moderator 授权工具）

| 分组                    | 工具名称（`tools/list` 对外公布）                                                                                                                                                                                                                                                                                              | 权限与边界                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **仓库与成本**（5）     | `cloudforge_list_repositories`、`cloudforge_get_repository`、`cloudforge_get_repository_insights`、`cloudforge_create_repository`、`cloudforge_get_usage`                                                                                                                                                                      | 按读/写权限过滤；`get_usage` 仅限站点管理员                                                                                                             |
| **PR 与 Actions**（10） | `cloudforge_list_pull_requests`、`cloudforge_get_pull_tree`、`cloudforge_get_pull_request`、`cloudforge_create_pull_request`、`cloudforge_comment_pull_request`、`cloudforge_merge_pull_request`、`cloudforge_retry_rebase`、`cloudforge_rerun_checks`、`cloudforge_get_run_logs`、`cloudforge_request_changes_on_review_flag` | `create_pull_request` 可携带 `session` 与 `request`（≤4000 字符）归并编码会话；普通连接仅能请求修改或合并已过门禁的 PR                                  |
| **议题与发行版**（7）   | `cloudforge_list_issues`、`cloudforge_get_issue`、`cloudforge_create_issue`、`cloudforge_update_issue`、`cloudforge_comment_issue`、`cloudforge_list_releases`、`cloudforge_create_release`                                                                                                                                    | 议题与 PR 共用递增编号 `#N`；发布版不可删除或覆写已有 `vX.Y.Z` tag                                                                                      |
| **通知与提交状态**（4） | `cloudforge_list_notifications`、`cloudforge_mark_notifications_read`、`cloudforge_create_commit_status`、`cloudforge_get_commit_status`                                                                                                                                                                                       | 外部 CI 状态写入需推送权限与完整存在的 SHA                                                                                                              |
| **审查 Agent**（5）     | `cloudforge_list_agents`、`cloudforge_list_repository_agents`、`cloudforge_invite_agent`、`cloudforge_remove_agent`、`cloudforge_create_agent`                                                                                                                                                                                 | 邀请/移除限仓库管理员；新建限站点管理员；删除仅限网页                                                                                                   |
| **Moderator 专属**（3） | `cloudforge_approve_review_finding`、`cloudforge_dismiss_change_request`、`cloudforge_approve_pull_request`                                                                                                                                                                                                                    | **仅用户在 Settings → MCP server 显式标记的 `mcp_moderators` 客户端可见可调**；每次强制弹出同意页，按调用者权限和锁定 `head` SHA 写入并审计 `via <app>` |

::: info 向后兼容前缀
为兼容早期集成，服务端仍将入站调用的 `gitorange_*` 工具名在路由层静默映射为对应的 `cloudforge_*` 处理器，但 `tools/list` 对外只返回 `cloudforge_*`。
:::

## 3. 提交状态、Webhooks 与出站签名

- **提交状态**：`POST /api/repos/{owner}/{repo}/statuses/{sha}`（支持 PAT `Bearer` / `token` 鉴权，只读 PAT 拒写）、`GET .../statuses/{sha}`、`GET .../commits/{ref}/status`。单提交上限 1000 条（超出 422），`description` 上限 140 字符，`target_url` 仅接受 http/https；结果立即参与 `review/checks.ts` 合并门禁并在 `success` 时尝试自动合并。
- **Webhooks（每库上限 20 个）**：支持 `push`、`pull_request`、`issues`、`issue_comment`、`release`、`status`、`ping`（或 `*`），请求携带 `X-CloudForge-*` 与兼容的 `X-GitHub-*` 请求头以及 `X-Hub-Signature-256: sha256=<HMAC>`。10 秒超时、不跟随 3xx 重定向，仅流式读取前 2048 字节；失败后按 **1 分钟 / 5 分钟 / 30 分钟 / 2 小时**退避，最多尝试 5 次，投递记录保留 14 天。

## 4. Actions 工作流与 Git LFS

- **GitHub Actions 语法子集**：解析 `.github/workflows/*.yml`，支持 `on: push`（含 `tags:`）、`pull_request`、`workflow_dispatch`、步骤表达式、`GITHUB_EVENT_PATH`、`actions/checkout` / `setup-node` 等常见用法、容器尺寸标签 `ubuntu-latest`（映射到 `standard-2`）及 `cloudforge-standard-1`..`4`，以及内置相关性动作 `cloudforge/relevance@v1`。
- **Git LFS Batch API**：挂载在 `/<owner>/<repo>.git/info/lfs/...`，支持 `basic` 传输适配器与 15 分钟 R2 预签名 URL；不支持 LFS File Locking（列表/校验返回空，加锁返回 `501`）。
