# Webhooks 与提交状态

两样东西让外部系统接进 CloudForge：**提交状态**让外部 CI（Jenkins、Buildkite、自建脚本）把检查结果报到某个提交上，和 Actions 的结果一样显示在页面上并参与合并门禁；**Webhooks** 在仓库里发生事情时（推送、拉取请求、议题、评论、发行版、提交状态）向外部地址发一个签名的 HTTP 请求。本文是设计说明，也是行为说明：实现以它为准，改行为时一并更新。

## 提交状态

`commit_statuses`（迁移 `0047`）每次上报一行：提交、`context`（检查的名字，默认 `default`）、`state`（`pending` / `success` / `failure` / `error`）、`target_url`（详情链接，只收 http/https）、`description`（≤ 140 字符）、上报人、时间。同一提交同一 `context` 以最新一次为准，旧的保留作历史；每个提交最多 1000 条，超过时 422。

- `POST /api/repos/{owner}/{repo}/statuses/{sha}`：上报，需要推送权限；`sha` 必须是这个仓库里存在的提交。
- `GET /api/repos/{owner}/{repo}/statuses/{sha}`：这个提交的全部上报，新的在前。
- `GET /api/repos/{owner}/{repo}/commits/{ref}/status`：合并状态（`ref` 可以是分支、标签或 SHA）：每个 `context` 的最新一条，以及总状态（有 `failure`/`error` 即 `failure`，否则有 `pending` 即 `pending`，否则 `success`；没有任何上报为 `null`）。

**令牌认证**：这三个接口除了会话 cookie，也接受个人访问令牌：`Authorization: Bearer <令牌>`（或 `token <令牌>`）。只读令牌只能读，Agent 的令牌一律拒绝。API 的其他接口仍然只认会话。

**参与门禁**：每个 `context` 的最新状态和 Actions 的最新运行一起判定（`review/checks.ts`）：`failure`/`error` 与失败的运行一样阻止合并（PR 状态原因 `check_failed`，`check` 为 context 名），`pending` 与运行中一样等待（`checks_running`）。合并按钮、自动合并、PR 状态、合并队列都看同一判定。上报 `success` 后，头部是这个提交的打开的拉取请求会尝试自动合并。检查徽章的接口（`GET …/commit-statuses`）同时返回 Actions 运行和外部状态。

## Webhooks

`webhooks`（每个仓库最多 20 个）：目标地址、密钥（加密保存，之后不再显示）、订阅的事件、是否启用、最近一次投递的结果。`webhook_deliveries`：每次投递一行，保存请求体、尝试次数、响应状态码与前 2 KB 响应、耗时、错误，保留 14 天。

只有仓库管理员能管理（`/api/repos/{owner}/{repo}/hooks`），增删改记审计日志（`webhook.created`、`webhook.updated`、`webhook.deleted`）。

### 事件

| 事件            | 何时                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `push`          | 推送更新了分支或标签（含合并落地、发行版打标签）                                           |
| `pull_request`  | `opened`、`closed`（合并时 `merged: true`）、`reopened`、`synchronize`（头部分支有新提交） |
| `issues`        | `opened`、`closed`、`reopened`、`assigned`                                                 |
| `issue_comment` | 议题或拉取请求下的新评论（`created`）                                                      |
| `release`       | 发行版发布（`published`）                                                                  |
| `status`        | 提交状态上报                                                                               |
| `ping`          | 新建 webhook 时、或手动“发送测试”时                                                        |

订阅 `*` 表示全部事件。请求体是 JSON，字段名与 GitHub 的相同子集（`action`、`repository`、`sender`、`pull_request`、`issue`、`comment`、`release`、`ref`/`before`/`after`/`commits` 等），便于沿用为 GitHub 写的接收端，但不承诺完全兼容。

### 请求

`POST` 到目标地址，`Content-Type: application/json`，带 `X-CloudForge-Event`、`X-CloudForge-Delivery`（投递 id）、`X-CloudForge-Hook-ID`，以及同值的 `X-GitHub-Event`、`X-GitHub-Delivery`、`X-GitHub-Hook-ID`；设置了密钥时带 `X-Hub-Signature-256: sha256=<请求体的 HMAC-SHA256>`。10 秒超时，不跟随重定向（3xx 算失败），2xx 算成功。

### 投递与重试

事件发生时为每个订阅它的已启用 webhook 写一行投递（与事件本身同一请求内），随后在响应之后发送。失败按 1 分钟、5 分钟、30 分钟、2 小时重试，最多 5 次；重试由每 5 分钟一次的定时任务执行（同一任务也补发被中断的通知邮件）。可以对任何一次投递“重新投递”（`POST …/hooks/{id}/deliveries/{deliveryId}/redeliver`），或发送测试（`POST …/hooks/{id}/pings`）。

### 地址限制

只允许 `http`/`https`，地址里不能带用户名密码；拒绝 `localhost`、`.local`、`.internal`、内网和保留 IP 字面量（`10/8`、`172.16/12`、`192.168/16`、`127/8`、`169.254/16`、`0.0.0.0`、`::1`、`fc00::/7`、`fe80::/10`），也拒绝实例自己的域名。Worker 本身无法访问你的内网，这些限制挡住的是明显的误用和自我回环。

## MCP 与网页（尚未完成）

计划中：MCP 工具 `cloudforge_create_commit_status` 与 `cloudforge_get_commit_status`，权限与接口相同；仓库设置里的 Webhooks 页面（列表、新建、编辑、删除、投递记录、重新投递、发送测试）；检查框与检查徽章列出外部状态（接口 `GET …/commit-statuses` 已返回 `statuses`）。在那之前用接口管理 webhook。

## 以后

组织级（实例级）webhook、按分支过滤事件、表单编码的请求体、连续失败自动停用、必需检查（分支保护规则里指定哪些 context 必须通过）。
