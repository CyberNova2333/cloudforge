# 第三阶段：系统架构与交互拓扑图

CloudForge 将边缘计算、关系状态、托管 Git 存储与按需容器解耦为六个分工明确的运行平面。所有 HTTP/WebSocket 与 Git 流量均经同一个 Cloudflare Worker 入口汇聚与鉴权，没有任何长期在线的自建虚机。

## 交互式系统拓扑（Archify）

<DiagramFrame
  src="/diagrams/cloudforge-architecture.html"
  title="CloudForge Architecture & Data Flow Diagram"
  aspect="890 / 448"
  new-tab-label="在新窗口全屏打开 ↗"
/>

## 运行平面划分

1. **统一网关与静态前端平面（Worker + React 18 SPA）**
   `worker/src/index.ts` 首先执行 `accessRuntimeResponse` 协议检查与请求体上限防线，随后分流 Git Smart HTTP（`worker/src/git/http/handler.ts`）、Git LFS Batch（`worker/src/lfs/http/handler.ts`）、OAuth 2.1 `.well-known` 发现与 `/mcp`（`worker/src/mcp/index.ts`）以及 `/api/*` OpenAPI 路由；页面静态资产与 Primer 主题界面直接由同源静态产物提供。
2. **D1 权威状态与事件台账平面（SQLite / Drizzle ORM）**
   67 份有序迁移（`migrations/0000`–`0066`）维护账户、会话、MFA/OIDC 策略、仓库与协作者兼容授权、`pull_requests` / `pr_edges` / `issues` / `notifications` / `webhooks`、`workflow_runs`、`agent_runs`、`usage_daily` 及 `push_events` 恢复队列表。所有高频更新采用批处理与 CAS 条件写，严格规避单条 SQL 超过 100 个参数上限。
3. **版本对象与大文件直传平面（Cloudflare Artifacts + R2）**
   Git 对象树与分支/标签引用存放在 `ARTIFACTS` 命名空间，每个 CloudForge 仓库对应独立托管仓库；Git LFS 大文件、Actions 分片日志与构建缓存分别存于 `LFS`、`ACTIONS_LOGS`、`ACTIONS_CACHE` 三个 R2 存储桶，LFS 读写通过 15 分钟签名 URL 绕开 Worker 内存流转。
4. **持久编排 Workflows 与有状态 DO 平面**
   - `ActionsRun` Workflow + `ActionsQueue` DO + `JobRunner` Container DO：按依赖图拉起隔离 Linux Runner 容器（`actions/runner/Dockerfile`）运行 CI 作业；
   - `MergeResolutionWorkflow` + `AgentReviewer` DO + `MergeResolver` DO：驱动多 Agent 审查（`engine: pass` / `engine: pi`）、PR 堆叠因果推断与线性化、AI 冲突解决以及代理从 `agent_lessons` 自学习；
   - `LiveHub` DO：维护浏览器 WebSocket 长连接池并做防抖增量刷新广播。
5. **AI 与邮件服务平面（Workers AI + AI Gateway + Email Sending）**
   分别由 `SUMMARY_MODEL`、`REVIEW_MODEL`、`ai.review_pi_model`、`RESOLVER_MODEL` 支撑差异摘要、审阅问答、深度工具探查和冲突修补；所有推理文本与 Diff 均包裹不可信随机隔离标签并计入 `ai_usage`；成员邀请、验证码与通知汇总通过 `EMAIL` 绑定出站投递。

::: tip 继续深入模块与源码
接下来建议按顺序阅读 [一次真实推送主流程](/docs/walkthrough)、四大[核心模块](/docs/modules/git-and-storage)以及 [源码地图与贡献流程](/docs/code-map)。
:::
