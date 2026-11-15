<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# 术语表

| 术语                      | 项目里的意思                                                                                                                             | 延伸阅读                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Cloudflare Artifacts      | 负责保存每个 CloudForge 仓库 Git 对象与引用的托管 Git 存储服务（单库上限 1 GB、协议 v1），通过 Workers 绑定 `ARTIFACTS` 访问             | [Git 与对象存储模块](modules/git-and-storage.md)                     |
| `ActionsRun`              | 承载单个 GitHub Actions 兼容工作流运行的 Cloudflare Workflow 入口，负责按拓扑阶段调度容器作业与持久化步骤日志                            | [Actions 容器与出站通知](modules/actions-containers-and-webhooks.md) |
| `JobRunner`               | 封装单个 Cloudflare Container（`standard-1` 至 `standard-4`）的 Durable Object，运行容器内步骤并将日志落盘至 R2                          | [Actions 容器与出站通知](modules/actions-containers-and-webhooks.md) |
| `ActionsQueue`            | 协调实例级（默认 10）与仓库级 Actions 最大并发容器槽位的 Durable Object 队列                                                             | [Actions 容器与出站通知](modules/actions-containers-and-webhooks.md) |
| `MergeResolutionWorkflow` | 编排 AI 审查、冲突解决、PR 堆叠发现（`stack` / `reconcile`）与代理学习（`learn`）的 Cloudflare Workflow                                  | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `AgentReviewer`           | 为单次 `engine: pi` 深度审查或 `learn` 任务创建的隔离 Durable Object（按 `id:timestamp` 或 `learn:id:attempt` 命名），持有只读沙箱工作区 | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `LiveHub`                 | 维持浏览器 WebSocket 连接（`GET /api/live`）并在资源变更后发送轻量级刷新信号（`repo:<id>`、`user:<id>`、`approvals`）的 Durable Object   | [代码地图：实时更新](code-map.md)                                    |
| `land_target`             | 堆叠 PR 最终真正要合并进去的目标分支；当 PR 临时叠在父 PR 分支上时，`base_ref` 指向父分支而 `land_target` 保留最终目标                   | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `decidePush`              | `worker/src/git/push-protection.ts` 中的接收包引用校验入口，阻止强推/删默认分支及外部写入 `refs/pull/*`                                  | [Git 与对象存储模块](modules/git-and-storage.md)                     |
| `landPull`                | `worker/src/merge/land.ts` 中的统一落地函数，对目标分支执行变基与快进 CAS 并衔接 `landing-recovery.ts`                                   | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `pr_edges`                | 记录同一目标下开放 PR 之间依附、等待或冲突关系的 D1 表（含 `pair` 发现边与 `order` 线性化边）                                            | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `reviewVerdict`           | 计算 PR 审查是否放行的唯一规则函数，被合并按钮、自动合并、PR 状态、Approvals 收件箱与 MCP 共同读取                                       | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `AGENT.md`                | 审查 Agent 自有内部仓库默认分支上的配置与提示词文件（YAML frontmatter + Markdown 指令），推送后触发自动刷新                              | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `engine: pi`              | 在 `AgentReviewer` Durable Object 中启用只读工具（`read` / `ls` / `find` / `grep`）分步探查仓库的深度审查引擎，区别于单轮 `engine: pass` | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `agent_lessons`           | 当人驳回 Agent 的 `change_requested` 意见或附带 teach note 决策且 PR 关闭后，排队由 Agent 自行修订 `knowledge/` 的学习任务表             | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `push_events`             | 推送在写入 Artifacts 生效后、返回 Git 响应前持久化到 D1 的后续工作 outbox，确保后台截断后可通过租约机制恢复                              | [一次真实主流程](walkthroughs/one-real-run.md)                       |
| `access_runtime_state`    | D1 中的永久单例协议门控行，记录最低协议版本与 `compat-v1` / `runtime-bridge-v1` 模式；不满足时 Worker 在入口返回 503                     | [身份认证、OIDC 与访问边界](modules/auth-oidc-and-access.md)         |
| `mcp_moderators`          | 用户在连接管理中显式标记可代为批准 PR 或忽略审查意见的 OAuth 应用记录；未标记的普通连接仅能查看、评论或请求修改                          | [身份认证、OIDC 与访问边界](modules/auth-oidc-and-access.md)         |
| 部署令牌（Deploy Token）  | 绑定到单个不可变 `repository_id` 的仓库级 HTTPS 机器凭据（前缀 `cfd_`），仅限 Git/LFS 使用，不能访问 REST、网页或 `/mcp`                 | [Git 与对象存储模块](modules/git-and-storage.md)                     |
| `cloudforge/relevance@v1` | CI 工作流中调用 Clef 模型判断变更影响模块并跳过无关测试作业的内置 step 动作                                                              | [Actions 容器与出站通知](modules/actions-containers-and-webhooks.md) |
| `BASE_URL`                | 实例对外提供服务并用于生成 Cookie 前缀（`__Secure-`）、OAuth 颁发者与邮件链接的公开根地址变量                                            | [身份认证、OIDC 与访问边界](modules/auth-oidc-and-access.md)         |
| `GITHUB_EVENT_PATH`       | 容器或 Actions 运行环境读取工作流触发上下文 JSON 的标准文件路径变量                                                                      | [一次真实主流程](walkthroughs/one-real-run.md)                       |
| `AGENT_REVIEWER`          | 绑定到 `AgentReviewer` Durable Object 的环境变量；未绑定时 `engine: pi` 会降级为单次 Pass 审查                                           | [AI 审查、堆叠与自动落地](modules/reviews-stacking-and-merge.md)     |
| `access-drain-status`     | 部署或升级前只读观察 D1 中未完成 Actions、Runner 会话、Agent 运行与 `push_events` 的 CLI 子命令                                          | [一次真实主流程](walkthroughs/one-real-run.md)                       |
