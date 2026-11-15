# Wrangler 绑定、环境变量与实例设置

CloudForge 把配置清晰拆成三层：**部署期基础设施绑定**（`wrangler.jsonc`）、**敏感机密凭据**（`wrangler secret` 或 `.dev.vars`）以及**运行时站点动态设置**（D1 `instance_settings` 表，可在 **站点管理 → Settings** 热改而无需重新部署 Worker）。

## 1. Workers 核心绑定与 Cron（`wrangler.jsonc.example`）

| 绑定 / 键名                              | 类型                                 | 职责说明                                                                                                                              | 备注                                    |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `DB`                                     | D1 Database                          | 保存用户、仓库元数据、PR、议题、通知、Actions 状态、Webhook 与审计事件                                                                | 需执行全部 `migrations/` 迁移           |
| `ARTIFACTS`                              | Artifacts Namespace                  | 托管每个仓库的 Git 对象、引用树与打包读写                                                                                             | 单仓库上限 1 GB，支持协议 v1            |
| `LFS` / `ACTIONS_LOGS` / `ACTIONS_CACHE` | R2 Buckets                           | 分别存储 Git LFS 二进制对象、Actions 作业分片日志、Actions 步骤缓存                                                                   | LFS 需配合 R2 S3 API 密钥签发预签名 URL |
| `ACTIONS_RUN`                            | Workflow (`ActionsRun`)              | 驱动工作流解析、阶段依赖与容器步骤执行                                                                                                | —                                       |
| `MERGE_RESOLUTION`                       | Workflow (`MergeResolutionWorkflow`) | 编排 AI 审查、冲突解决、PR 堆叠发现/收敛、定时扫描与 Agent 学习                                                                       | —                                       |
| `JOB_RUNNER`                             | Durable Object + Container           | 运行实际容器作业（`cloudforge-standard-1`..`4`），由 `actions/runner/Dockerfile` 构建                                                 | 若需不同实例大小需在模板声明容器类      |
| `ACTIONS_QUEUE`                          | Durable Object (`ActionsQueue`)      | 控制实例级与单仓库级最大并发容器槽位                                                                                                  | 避免高并发仓库挤占全部资源              |
| `AGENT_REVIEWER`                         | Durable Object (`AgentReviewer`)     | 为 `engine: pi` 与学习任务提供带 SQLite `/repo` `/agent` 的隔离沙箱                                                                   | 缺失时 `engine: pi` 自动退回单轮 Pass   |
| `MERGE_RESOLVER` / `LIVE_HUB`            | Durable Objects                      | 冲突解决辅助 DO 与面向浏览器的 WebSocket 增量推送中心（`LiveHub`）                                                                    | 页面免刷新实时同步状态                  |
| `AI` / `EMAIL`                           | Workers AI / SendEmail               | 调用默认 GLM 模型；发送成员邀请、密码重置、邮箱验证与通知摘要邮件                                                                     | `EMAIL` 域名需完成 Email Sending 验证   |
| `triggers.crons`                         | 三条定时任务                         | `*/5 * * * *` 重试 Webhook/补发 24h 内邮件与清理 OIDC 登录态；`30 2 * * *` 同步用量；`17 4 * * *` 按保留期清理日志与恢复学习/关闭任务 | 见 `worker/src/cron.ts`                 |

## 2. 环境变量与敏感 Secrets

普通文本变量位于 `wrangler.jsonc` 的 `vars` 中，而密钥务必使用 `pnpm exec wrangler secret put <KEY>` 注入（本地开发写入 `.dev.vars`）：

| 变量名                                              | 是否机密         | 作用与说明                                                                                                   |
| --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `BASE_URL`                                          | 普通 Var         | 实例访问根 URL（例如 `https://git.example.com`），决定 `__Secure-` Cookie 前缀、OAuth 颁发者与邮件回调地址   |
| `APP_NAME`                                          | 普通 Var         | 实例名称默认 fallback（也可在后台动态修改 `app.name`）                                                       |
| `FROM_EMAIL`                                        | 普通 Var         | 邀请与通知邮件发信邮箱默认地址                                                                               |
| `SUMMARY_MODEL` / `REVIEW_MODEL` / `RESOLVER_MODEL` | 普通 Var         | 分别为文件摘要（默认 `@cf/zai-org/glm-5.3-flash`）、审查/深度审查（`@cf/zai-org/glm-5.3`）及冲突解决默认模型 |
| `AI_GATEWAY_ID` / `CLOUDFLARE_ACCOUNT_ID`           | 普通 Var         | 绑定 AI Gateway 及统计、R2 端点与 GraphQL 用量查询                                                           |
| `BETTER_AUTH_SECRET`                                | **Secret**       | 签名会话 Cookie、OAuth 状态与敏感挑战，需至少 32 字节高熵随机值                                              |
| `SECRETS_ENCRYPTION_KEY`                            | **Secret**       | 32 字节 Base64 AES-GCM 密钥，用于密封仓库/实例 Actions Secrets 与 Webhook 密钥                               |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`         | **Secret**       | 用于签发 Git LFS 上传/下载（15 分钟）与缓存预签名 R2 URL                                                     |
| `CLOUDFLARE_API_TOKEN`                              | **Secret**       | 仅用于定时任务查询 Cloudflare GraphQL Analytics API 估算月度账单用量                                         |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`       | Var / **Secret** | 可选 Cloudflare Turnstile 人机校验                                                                           |

## 3. 站点管理动态设置（`SETTINGS` 注册表）

站点管理员可在 **站点管理 → Settings** 修改并在 D1 中原子持久化以下配置，未覆盖时自动回落至环境变量或内置默认值（完整校验规则见 `worker/src/instance/settings.ts`）：

| 设置键名                                                                                 | 分组      | 默认值与取值范围                                                                                 |
| ---------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `app.name`                                                                               | General   | 默认取 `APP_NAME` 或 `CloudForge`（1–60 字符）                                                   |
| `ui.default_language`                                                                    | General   | `auto`（跟随浏览器优先中文） / `zh` / `en`                                                       |
| `email.from`                                                                             | General   | 默认取 `FROM_EMAIL`                                                                              |
| `signup.enabled` / `signup.allowed_domains` / `signup.require_verification`              | Accounts  | 自助注册默认关闭；开启并限制域名或开启邮箱校验时，未配置发信会保持注册关闭                       |
| `ai.summary_model` / `ai.review_model` / `ai.review_pi_model` / `ai.resolver_model`      | AI models | 必须是 `@cf/...` 格式 Workers AI 模型；`ai.review_pi_model` 未单独覆盖前跟随 `ai.review_model`   |
| `review.allow_self_approval`                                                             | Reviews   | 默认 `false`（严格禁止 PR 作者自批或利用 AI 代批）                                               |
| `review.pi_minutes` / `pi_max_tool_calls` / `pi_max_model_calls` / `pi_max_input_tokens` | Reviews   | 默认 30 分钟（5–60）、60 次工具（5–500）、80 次模型（5–500）、4,000,000 input tokens             |
| `review.learning` & `review.learn_*`                                                     | Reviews   | 默认开启自学习（关闭后仅停止新增消费）；单次学习默认 10 分钟、30 工具/模型调用、1,000,000 tokens |
| `actions.retention_days`                                                                 | Actions   | 默认 `90` 天（1–400，置空 `null` 永久保留）；到期后清理已完成运行、步骤、日志及 `agent_runs`     |
| `actions.max_concurrent_jobs` / `max_concurrent_jobs_per_repo`                           | Actions   | 全实例默认 `10`（1–500）；单库默认不限制（`null`）                                               |
| `actions.max_runner_size`                                                                | Actions   | 默认 `standard-4`，约束工作流可申请的最大容器规格                                                |
