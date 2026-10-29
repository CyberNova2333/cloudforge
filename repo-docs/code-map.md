# CloudForge 代码地图

先读[主流程的输入与交接](walkthroughs/one-real-run.md)，再按责任定位修改。本页只覆盖已声明主流程，不把目录出现过当作完整模块调查。

| 路径                    | 职责                                    | 关键代码                                   | 与主流程的关系          |
| ----------------------- | --------------------------------------- | ------------------------------------------ | ----------------------- |
| `worker/src/`           | 识别 Git HTTP 并取得访问上下文          | `worker/src/git-http.ts`                   | Worker 请求入口         |
| `worker/src/git/`       | 读取推送命令、保护引用并连接对象存储    | `worker/src/git/push-protection.ts`        | Git HTTP 推送分支       |
| `worker/src/lib/`       | 在响应前持久化成功引用并恢复后续工作    | `worker/src/lib/push-events.ts`            | Git HTTP 与恢复调用     |
| `worker/src/__tests__/` | 用本地 D1 与 Artifacts 替身约束推送行为 | `worker/src/__tests__/push-events.test.ts` | Vitest workerd 测试入口 |

## `worker/src/`

识别 Git HTTP 并取得访问上下文。范围仅为下表入口及主流程直接使用的契约，其余文件没有逐一审核。

| 重要代码                              | 功能                           | 关键符号                                     | 调用方 / 使用方 |
| ------------------------------------- | ------------------------------ | -------------------------------------------- | --------------- |
| [职责入口](../worker/src/git-http.ts) | 识别 Git HTTP 并取得访问上下文 | `authenticateRepoRequest / handleGitRequest` | Worker 请求入口 |

相关验证：`worker/src/__tests__/git-http.test.ts`。本轮只检查可读证据，业务测试没有执行。

## `worker/src/git/`

读取推送命令、保护引用并连接对象存储。范围仅为下表入口及主流程直接使用的契约，其余文件没有逐一审核。

| 重要代码                                         | 功能                                 | 关键符号     | 调用方 / 使用方   |
| ------------------------------------------------ | ------------------------------------ | ------------ | ----------------- |
| [职责入口](../worker/src/git/push-protection.ts) | 读取推送命令、保护引用并连接对象存储 | `decidePush` | Git HTTP 推送分支 |

相关验证：`worker/src/__tests__/push-protection.test.ts`。本轮只检查可读证据，业务测试没有执行。

## `worker/src/lib/`

在响应前持久化成功引用并恢复后续工作。范围仅为下表入口及主流程直接使用的契约，其余文件没有逐一审核。

| 重要代码                                     | 功能                                 | 关键符号                    | 调用方 / 使用方     |
| -------------------------------------------- | ------------------------------------ | --------------------------- | ------------------- |
| [职责入口](../worker/src/lib/push-events.ts) | 在响应前持久化成功引用并恢复后续工作 | `recordPush / runPushEvent` | Git HTTP 与恢复调用 |

相关验证：`worker/src/__tests__/push-events.test.ts`。本轮只检查可读证据，业务测试没有执行。

## `worker/src/__tests__/`

用本地 D1 与 Artifacts 替身约束推送行为。范围仅为下表入口及主流程直接使用的契约，其余文件没有逐一审核。

| 重要代码                                                | 功能                                    | 关键符号             | 调用方 / 使用方         |
| ------------------------------------------------------- | --------------------------------------- | -------------------- | ----------------------- |
| [职责入口](../worker/src/__tests__/push-events.test.ts) | 用本地 D1 与 Artifacts 替身约束推送行为 | `推送中断与恢复用例` | Vitest workerd 测试入口 |

相关验证：`worker/vitest.config.ts`。本轮只检查可读证据，业务测试没有执行。

## Agent 规则同步工具

[scripts/sync-agents.mjs](../scripts/sync-agents.mjs) 以 `AGENTS.md` 为唯一规则正文，生成导入它的 `CLAUDE.md`；技能仍从 `.claude/skills/` 复制到 `.agents/skills/`。`yarn agents:sync --check` 只报告差异，写入模式也不会覆盖规范源。回归见 [sync-agents.test.ts](../scripts/__tests__/sync-agents.test.ts)，覆盖缺失和过时入口、CRLF、技能副本清理以及规范源不被改写。

## 覆盖范围

覆盖 Git HTTPS 推送入口、引用保护、Artifacts 交接和持久化推送事件；只追踪这些目录内与推送有关的文件。PR 审查、合并、Actions 执行器、OAuth/MFA、MCP、安装器、SPA 与其他数据库模块留给既有 docs 专题，本包不声称完整架构覆盖。认证策略的预览、受限会话、OAuth 撤销和离线恢复边界见 [认证专题](../docs/authentication.md#管理员认证策略)。提交、远端推送与生产部署分别核验。

生成物、依赖安装目录、临时日志及第三方供应商源码不作为本次第一方模块地图。修改范围外机制前应重新调查，不能从本页推断兼容性。

证据状态：除特别标注外，本页基于当前源码已确认。
