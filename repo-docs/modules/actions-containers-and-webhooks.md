<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Actions 容器调度、提交状态与 Webhooks

CloudForge 将持续集成拆分为内置容器运行器（Actions）和外部系统回调通道（提交状态 + Webhooks），两者在最终 PR 门禁中汇合为同一套检查结论。承接 [一次真实主流程](../walkthroughs/one-real-run.md) 的 `push_events` 之后，本模块描述工作流如何排队进入容器、如何在受控凭据边界内执行步骤，以及如何保证出站 Webhook 与延时通知不因单次请求超时丢失。

## `ActionsRun` 工作流与容器并发隔离

工作流文件通过 `worker/src/actions/workflow-file.ts` 与 `worker/src/actions/plan.ts` 解析，支持 `on: push`、`pull_request`、`release` 等触发与 `ubuntu-latest`（默认映射到 `standard-2`）及 `cloudforge-standard-1`..`4` 规格。每次触发由 `ActionsRun` Workflow（`worker/src/actions/run-workflow.ts`）驱动，并在执行具体作业前向 `ActionsQueue`（`worker/src/actions/queue.ts`）申请并发槽位：

- **双层槽位控制**：站点设置中的 `actions.max_concurrent_jobs`（默认 10）限制整实例并发容器总数，`actions.max_concurrent_jobs_per_repo` 防止单一高活跃仓库占满名额；每个容器实例由 `JobRunner` Durable Object（`worker/src/actions/job-runner.ts`）管理，步骤实时输出分片写入 `ACTIONS_LOGS` R2 桶，产物与缓存分别走 `ARTIFACTS`/R2（`worker/src/actions/artifacts.ts`、`worker/src/actions/cache.ts`）。
- **Secrets 隔离与白名单**：实例级密钥必须在站点管理后台为特定仓库开启白名单后才可在该仓库运行中注入，日志行在落盘与流式返回前由 `worker/src/actions/secrets.ts` 掩码替换。
- **相关性门控 `cloudforge/relevance@v1`**：工作流（例如仓库自身的 `.github/workflows/ci.yml`）可通过 `worker/src/actions/relevance.ts` 定义模块文件集合并调用 Clef 模型输出 `run-<module>` 布尔值，跳过未受影响模块的测试作业。

```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: cloudforge/relevance@v1
        with:
          modules: |
            core: worker/src/**
```

## 外部 CI 提交状态与 Webhooks 出站契约

除内置容器作业外，外部 CI 可携带个人访问令牌（仅 `POST/GET .../statuses/{sha}` 与 `.../commits/{ref}/status` 接受 PAT，其余 REST 接口仍仅认 Cookie 会话）上报状态。`worker/src/review/checks.ts` 将外部 `commit_statuses` 与 `workflow_runs` 最新结果统一合并判定：`failure` 或 `error` 直接阻塞自动合并（PR 原因 `check_failed`），`pending` 表现为 `checks_running`。

| 出站/上报交互场景                       | 约束与校验边界                                                        | 失败与重试语义                                                       |
| --------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 只读 PAT 调用 `POST .../statuses/{sha}` | `worker/src/auth/token-auth.ts` 与路由联检阻断                        | 返回拒绝状态，不写入 `commit_statuses`                               |
| 管理员新建指向内网或回环地址的 Webhook  | `worker/src/webhooks/service.ts` 拒绝 `.local`、`localhost` 与私网 IP | 直接拒绝保存或出站，避免 SSRF 探测内部地址                           |
| 目标 Webhook 返回 5xx 或响应超过 10 秒  | 保留在 `webhook_deliveries` 并按 1/5/30/120 分钟退避                  | 最多 5 次重试；每 5 分钟由 `worker/src/cron.ts` 推进，日志保留 14 天 |

每日与高频定时任务均由 `worker/src/cron.ts` 调度：`*/5 * * * *` 驱动失败 Webhook 重试、补发 24 小时内被响应截断的通知邮件并清理过期 OIDC 登录态；`17 4 * * *` 按 `actions.retention_days` 清理过期日志与僵尸运行；`30 2 * * *` 同步 Cloudflare 用量统计。需要确认身份认证与权限模型如何限制这些管理端点时，可继续阅读 [身份认证、OIDC 与访问边界](auth-oidc-and-access.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
