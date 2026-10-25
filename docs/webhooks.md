# Webhooks 与提交状态

两样东西让外部系统接进 CloudForge：**提交状态**让外部 CI（Jenkins、Buildkite、自建脚本）把检查结果报到某个提交上，和 Actions 的结果一样显示在页面上并参与合并门禁；**Webhooks** 在仓库里发生事情时（推送、拉取请求、议题、评论、发行版、提交状态）向外部地址发一个签名的 HTTP 请求。本文是设计说明，也是行为说明：实现以它为准，改行为时一并更新。

## 提交状态

`commit_statuses`（迁移 `0047`）每次上报一行：提交、`context`（检查的名字，默认 `default`）、`state`（`pending` / `success` / `failure` / `error`）、`target_url`（详情链接，只收 http/https）、`description`（≤ 140 字符）、上报人、时间。同一提交同一 `context` 以最新一次为准，时间相同时以后插入的记录为准，旧的保留作历史；每个提交最多 1000 条，超过时 422。

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

停用 webhook 阻止新的普通事件入队；已经排队的投递和管理员显式发送的测试、重新投递仍会发送。删除 webhook 会连同待发送记录一起删除。重试是至少一次投递：接收端应按 delivery ID 去重；管理员重新投递会生成新 ID。过期发送者不能覆盖新一次尝试的结果，最后一次中断也会最终标记失败。响应体仅流式读取前 2048 字节并取消剩余读取；配置过密钥但不能解密时拒绝发送，重新设置密钥后再重投。

### 地址限制

只允许 `http`/`https`，地址里不能带用户名密码；拒绝 `localhost`、`.local`、`.internal`、内网和保留 IP 字面量（`10/8`、`172.16/12`、`192.168/16`、`127/8`、`169.254/16`、`0.0.0.0`、`::1`、`fc00::/7`、`fe80::/10`），也拒绝实例自己的域名，比较前统一大小写和 DNS 末尾的点。应用检查 URL 中的主机名和 IP 字面量，不自行解析并验证域名的全部 DNS 结果；出站访问还受 Cloudflare Workers 的网络环境限制。

## MCP 与网页

- 仓库管理员在 **仓库设置 → Webhooks** 管理地址、事件和启用状态，查看投递的请求体、响应预览、耗时和错误，发送测试或重新投递。编辑时密钥默认保留，可明确选择替换或移除，原密钥不会回显。
- PR 检查框及提交的检查徽章列出 Actions 和外部 CI 状态、描述与详情链接；只有外部状态时也正常显示。个人访问令牌页说明 Bearer 用途和只读限制。
- MCP `cloudforge_create_commit_status` 要求仓库推送权限以及存在的完整提交 SHA；字段限制与 REST 共用。成功上报可能触发自动合并，只应报告实际执行的检查结果。
- MCP `cloudforge_get_commit_status` 要求仓库读取权限，接受 SHA、分支或标签，缺省使用默认分支，返回各 context 最新状态及合并状态；没有任何外部上报时状态为 `null`，不代表 Actions 已通过。

## 以后

组织级（实例级）webhook、按分支过滤事件、表单编码的请求体、连续失败自动停用、必需检查（分支保护规则里指定哪些 context 必须通过）。
