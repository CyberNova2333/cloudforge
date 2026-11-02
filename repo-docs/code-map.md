<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# CloudForge 代码地图

先读[主流程的输入与交接](walkthroughs/one-real-run.md)，再按责任定位修改。成员推送分支时，请求在 Git 协议入口取得权限，经引用保护后写入 Artifacts，实际成功的引用在响应前登记为可恢复事件。本页先定位这条已调查的主流程，再提供其他业务域与工具的目录导航；目录导航不表示对应机制已完成行为审计。

## Git 推送主流程的修改位置

| 路径                       | 职责                       | 关键代码                                                                                                   | 与主流程的关系                                 | 验证入口                                                  |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `worker/src/`              | 请求分流与公共中间件       | [Worker 装配入口](../worker/src/index.ts) 的 `fetch`、`app`                                                | 先区分 Git、LFS 与应用请求；保留现有入口和导出 | `worker/src/__tests__/platform/smoke.test.ts`             |
| `worker/src/git/http/`     | Git 请求鉴权与协议处理     | [Git HTTP 适配](../worker/src/git/http/handler.ts) 的 `authenticateRepoRequest`、`handleGitRequest`        | 取得仓库权限后再处理推送                       | `worker/src/__tests__/git/git-http.test.ts`               |
| `worker/src/git/`          | 引用保护与对象存储         | [推送保护](../worker/src/git/push-protection.ts) 的 `decidePush`；[Git 服务](../worker/src/git/service.ts) | 检查引用更新并访问 Artifacts                   | `worker/src/__tests__/git/push-protection.test.ts`        |
| `worker/src/git/`          | 记录成功引用并恢复后续工作 | [推送事件](../worker/src/git/push-events.ts) 的 `recordPush`、`runPushEvent`                               | HTTP 响应前记录，后台或定期恢复继续处理        | `worker/src/__tests__/git/push-events.test.ts`            |
| `worker/src/repositories/` | 仓库身份与访问视图         | [仓库服务](../worker/src/repositories/service.ts) 与[权限内核](../worker/src/repositories/permissions.ts)  | Git 与 API 使用相同仓库身份和权限规则          | `worker/src/__tests__/access/repo-permissions.test.ts`    |
| `worker/src/access/`       | 运行时准入                 | [协议状态](../worker/src/access/runtime.ts) 与[拒绝响应](../worker/src/access/http/runtime.ts)             | 在认证和 Artifacts 调用前读取当前兼容协议      | `worker/src/__tests__/access/access-runtime-http.test.ts` |

这些测试路径是验证入口；本页不将测试文件存在或路径调整视为测试通过。实际执行结果记录在[指南变更记录](change-log.md)。

## `worker/src/`

根层保留装配入口、定时任务和上下文类型。新增领域路由在入口注册，实际实现回到所属域；Wrangler 仍从原入口取得 Durable Object 与 Workflow 导出。

| 重要代码                           | 功能                           | 关键符号       | 调用方 / 使用方       |
| ---------------------------------- | ------------------------------ | -------------- | --------------------- |
| [应用装配](../worker/src/index.ts) | 区分协议请求、安装中间件与路由 | `fetch`、`app` | Worker 运行时         |
| [定时恢复](../worker/src/cron.ts)  | 调度保留期清理及未完成任务恢复 | `runScheduled` | Worker scheduled 入口 |

## `worker/src/git/http/`

HTTP 适配集中处理请求识别、鉴权、保护检查与流式转发；协议字节解析和对象服务留在上级 Git 域，避免其他调用者依赖 HTTP 入口。

| 重要代码                                      | 功能                              | 关键符号                                      | 调用方 / 使用方       |
| --------------------------------------------- | --------------------------------- | --------------------------------------------- | --------------------- |
| [协议入口](../worker/src/git/http/handler.ts) | 按操作取得仓库权限并处理 Git 请求 | `authenticateRepoRequest`、`handleGitRequest` | Worker 入口、LFS 鉴权 |

## `worker/src/git/`

保护和存储操作仍在此域；推送事件也归入此处，使“更新引用后必须记录什么”与协议处理可以一起定位。

| 重要代码                                         | 功能                                     | 关键符号                           | 调用方 / 使用方    |
| ------------------------------------------------ | ---------------------------------------- | ---------------------------------- | ------------------ |
| [推送保护](../worker/src/git/push-protection.ts) | 读取推送命令并判断可更新的引用           | `readReceiveRequest`、`decidePush` | Git HTTP 入口      |
| [对象服务](../worker/src/git/service.ts)         | 通过 Artifacts 读取对象和引用            | `GitService`                       | 路由、合并与审查   |
| [推送事件](../worker/src/git/push-events.ts)     | 在回复前记录结果，按持久状态恢复后续工作 | `recordPush`、`runPushEvent`       | Git HTTP、定时恢复 |

## `worker/src/repositories/`

仓库身份、生命周期、权限与读模型在同一域。HTTP 路由位于该域的 `http/`，Git、通知和 MCP 等调用方复用服务及权限内核。

| 重要代码                                              | 功能                                           | 关键符号                                  | 调用方 / 使用方 |
| ----------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- | --------------- |
| [仓库服务](../worker/src/repositories/service.ts)     | 查找仓库、计算权限与列表可见性                 | `findRepo`、`permissionsFor`、`visibleTo` | Git、API、MCP   |
| [权限能力](../worker/src/repositories/permissions.ts) | 将现有角色权限映射到操作能力，并限制令牌 scope | `can`、`withTokenScope`                   | 路由、协议入口  |

## `worker/src/access/`

该域保存兼容权限写入和运行时协议准入；HTTP 拒绝响应位于 `http/`，主库状态读取可供独立后台入口复用。目录整理不改变协议版本或开放新角色。

| 重要代码                                              | 功能                                     | 关键符号                                        | 调用方 / 使用方           |
| ----------------------------------------------------- | ---------------------------------------- | ----------------------------------------------- | ------------------------- |
| [运行时准入](../worker/src/access/runtime.ts)         | 每次从 D1 主库检查最低协议要求           | `assertAccessRuntime`                           | Worker、Git/LFS、后台入口 |
| [HTTP 拒绝响应](../worker/src/access/http/runtime.ts) | 构造不缓存的拒绝响应并限定元数据探针例外 | `accessRuntimeResponse`、`isAccessRuntimeProbe` | HTTP 入口                 |

## 业务域与层级导航

Worker 按业务归属组织。各域的 `http/` 保存 HTTP 路由或协议适配；域内其余文件保存业务服务、读模型和后台编排。共享 OpenAPI 契约与响应助手位于 `worker/src/http/`，通用 SQL 和文本工具位于 `worker/src/shared/`。数据库声明仍由 `worker/src/db/` 集中维护。

一次修改应先找到所属业务域，再决定需要调整 HTTP 输入输出、业务服务还是数据库声明。例如修改仓库创建时，从[仓库路由](../worker/src/repositories/http/repos-router.ts)进入[创建服务](../worker/src/repositories/create.ts)，涉及声明才进一步查看数据库。既有文件可能同时包含查询、服务和中间件；目录组织不承诺所有模块已经实现严格的单向依赖。

下表是按当前源码文件、导出和调用位置建立的查找索引。完整行为、约束和验收仍以相应专题及源码为准。

| 读者要找的职责                     | 目录与关键入口                                                                                                                                                              | 深入阅读                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 仓库、分支、提交归属与报表         | `repositories/`：`service.ts`、`create.ts`、`deletion.ts`、`permissions.ts`、`stats.ts`、`health.ts`，以及 `http/` 路由                                                     | [总体架构](../docs/architecture.md)、[权限现状](../docs/permissions.md)                               |
| Git 与大文件协议                   | `git/`：`worker/src/git/http/handler.ts`、`push-protection.ts`、`push-events.ts`、`service.ts`；`lfs/`：`worker/src/lfs/http/handler.ts`、`storage.ts`                      | [Git 端点](../docs/architecture.md#the-git-endpoint)、[Git LFS](../docs/architecture.md#git-lfs)      |
| PR、合并、堆叠与发布               | `pulls/`：`service.ts`、`state.ts`、`sessions.ts`；`merge/`：`land.ts`、`queue.ts`；`stack/`：`discover.ts`、`retarget.ts`；`releases/`：`service.ts`、`version.ts`         | [总体架构](../docs/architecture.md)、[自动合并](../docs/auto-merge.md)                                |
| 审查、代理账号、学习与运行记录     | `review/`、`agents/`、`learn/`、`agent-runs/`；审查入口 `worker/src/review/head.ts`，账号与邀请在 `worker/src/agents/accounts.ts`、`worker/src/agents/membership.ts`        | [自动合并](../docs/auto-merge.md)                                                                     |
| Actions、使用量与 AI 接入          | `actions/`：`trigger.ts`、`executor.ts`、`queue.ts`；`usage/`：`record.ts`、`report.ts`；`ai/`：`gateway.ts`、`retry.ts`                                                    | [开发说明](../docs/development.md)、[总体架构](../docs/architecture.md)                               |
| 认证、外部身份和准入               | `auth/`：`index.ts`、`session.ts`、`policy.ts`、`tokens.ts`、`deploy-tokens.ts`；`oidc/`：`provider.ts`、`service.ts`、`sign-in.ts`；`access/`：`runtime.ts`、`write.ts`    | [认证](../docs/authentication.md)、[OIDC](../docs/oidc.md)、[权限设计](../docs/team-access-design.md) |
| 成员资料、团队命名空间及实例设置   | `members/`：`users.ts`、`person-ref.ts`、`namespaces.ts`、`http/`；`instance/`：`settings.ts`、`setup-checks.ts`、`http/`                                                   | [权限现状](../docs/permissions.md)、[配置说明](../docs/configuration.md)                              |
| Issue、通知、Webhook 与审计        | `issues/`：`service.ts`、`links.ts`；`notifications/`：`service.ts`、`inbox.ts`、`email-delivery.ts`；`webhooks/`：`service.ts`、`events.ts`；`worker/src/audit/service.ts` | [Issues](../docs/issues.md)、[通知](../docs/notifications.md)、[Webhook](../docs/webhooks.md)         |
| 搜索、实时更新与 MCP 适配          | `worker/src/search/service.ts`；`live/`：`feed.ts`、`publish.ts`、`hub.ts`、`route.ts`；`mcp/`：`index.ts` 与各类 `*-tools.ts`                                              | [总体架构](../docs/architecture.md)                                                                   |
| 跨域 HTTP 契约、通用工具与数据声明 | `http/`：`schemas.ts`、`openapi-helpers.ts`、`request-log.ts`；`shared/`：`sql-set.ts`、`text-match.ts`、`markdown-text.ts`；`db/`：schema 与声明触发器                     | [开发说明](../docs/development.md)、根 [Agent 规则](../AGENTS.md)                                     |
| 装配、定时任务及验证               | `index.ts`、`cron.ts`、`variables.ts`；`__tests__/` 按领域分组，`helpers/` 共享 fixture；运行配置仍在 `worker/vitest.config.ts`                                             | [开发说明](../docs/development.md#ci)                                                                 |

表中路径均相对于 `worker/src/`。编码会话在 `worker/src/pulls/sessions.ts`，浏览器会话在 `worker/src/auth/session.ts`；合并队列在 `worker/src/merge/queue.ts`，Actions 调度队列在 `worker/src/actions/queue.ts`。修改时应先确认所指对象，避免仅凭相似文件名选错模块。

## 开发与安装脚本导航

项目命令仍以[根 package.json](../package.json)的 Yarn scripts 为入口。工具脚本按职责归组，安装器的命令行入口仍为 `scripts/cloudforge/cli.ts`，发布包入口仍为 `scripts/cloudforge/pack.mjs`。

| 工具职责                     | 位置与入口                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 本地开发与演示数据           | `scripts/development/dev.mjs`、`scripts/development/visual-server.mjs`；`scripts/seed-demo/` 的入口、数据、历史和 fixture    |
| 测试执行、报告与 Git 检查    | `scripts/testing/test-workers.mjs`、`scripts/testing/test-reporter.ts`；`scripts/githooks/`                                  |
| 数据库、认证表与绑定类型生成 | `scripts/database/generate-db.mjs`、`scripts/database/auth-schema-config.ts`；`scripts/cloudflare/cf-typegen.mjs`            |
| 规则同步、许可、本地化和发布 | `scripts/agents/`、`scripts/licensing/`、`scripts/i18n/`、`scripts/release/`                                                 |
| 安装器命令、计划和本地状态   | `scripts/cloudforge/commands/`、`planning/`、`installation/`；CLI 组合这些模块                                               |
| 安装器外部接口、恢复和分发   | `scripts/cloudforge/platform/`、`recovery/`、`access/`、`distribution/`、`ui/`                                               |
| Node 脚本验证                | 各工具的 `__tests__/`；安装器测试在 `scripts/cloudforge/__tests__/` 内按职责分组，共用 `scripts/cloudforge/vitest.config.ts` |

目录改变不授予运行安装、发布或恢复命令的权限；操作边界仍见[开发说明](../docs/development.md)、[升级维护](../docs/updating.md)及根规则。

## Agent 规则同步工具

[scripts/agents/sync-agents.mjs](../scripts/agents/sync-agents.mjs) 以 `AGENTS.md` 为唯一规则正文，生成导入它的 `CLAUDE.md`；技能仍从 `.claude/skills/` 复制到 `.agents/skills/`。`yarn agents:sync --check` 只报告差异，写入模式也不会覆盖规范源。回归见 [sync-agents.test.ts](../scripts/agents/__tests__/sync-agents.test.ts)，覆盖缺失和过时入口、CRLF、技能副本清理以及规范源不被改写。

认证表的生成入口在[项目命令](../package.json)，`yarn auth:update` 使用本地锁定的 CLI，再补齐 fork notice 并格式化。工具依赖与业务依赖一起纳入锁文件和审计；生成命令不执行数据库迁移。版本与操作边界见[开发说明](../docs/development.md#ci)。

## 认证策略的修改路由

需要修改强制 MFA 时，先读[认证专题](../docs/authentication.md#管理员认证策略)。下表只定位本次复核的策略边界，不扩展为 OAuth、MFA 或 SPA 全目录地图。

| 改动目标                     | 入口及职责                                                                                                                                                                                                                                                              | 相关验证                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 浏览器受限通道与原生认证入口 | [策略判断](../worker/src/auth/policy.ts) 的 `evaluatePolicyAccess`、`enforceBrowserPolicy`、`requireNativePolicy`；[认证流程](../worker/src/auth/two-factor.ts) 在真实验证完成后的写点核对策略版本                                                                      | `authentication-policy-session.test.ts`                                |
| 管理员预览与执行             | [预览和条件写](../worker/src/auth/policy-management.ts) 的 `previewPolicy`、`applyPolicy`；[声明触发器](../worker/src/db/auth-policy-triggers.ts) 原子处理 OAuth 撤销、预览消费及审计；[管理路由](../worker/src/auth/http/authentication-policy-router.ts) 校验请求形状 | `authentication-policy.test.ts`、`authentication-policy-audit.test.ts` |
| OAuth 凭据与旧授权拒绝       | [授权代际](../worker/src/auth/oauth-grants.ts)、[MCP 身份](../worker/src/mcp/oauth-session.ts) 与[数据库写入围栏](../worker/src/db/oauth-grant-triggers.ts) 共同核对当前策略和授权代际                                                                                  | `authentication-policy-oauth.test.ts`                                  |
| 页面引导与确认               | [应用入口](../src/App.tsx) 根据通道引导；[管理员表单](../src/components/admin/AdminAuthenticationPolicy.tsx) 先预览再确认；[账户安全页](../src/pages/settings/SettingsSecurity.tsx) 承担首次绑定和恢复码保存                                                            | `src/lib/auth/authenticationPolicy.test.ts`；实际组件验证另行记录      |

表中的测试名表示验证入口，不表示本轮已全部运行通过。新增数据库结构来自生成迁移 `0056`，迁移和部署分别授权与验证。

## OIDC 绑定与 SSO 的修改路由

完整行为见 [OIDC 身份绑定与 SSO](../docs/oidc.md)。下表只定位显式绑定、配置发布、已有绑定登录及来源撤权，不扩展为整个认证目录调查。

| 改动目标             | 入口及职责                                                                                                                                                                                                                                                                        | 相关验证                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 配置和外部协议       | [provider.ts](../worker/src/oidc/provider.ts) 校验公开配置、secret 摘要、固定回调、PKCE、ID token、出站和完成数据缓存；[errors.ts](../worker/src/oidc/errors.ts) 给出安全错误                                                                                                     | `oidc-provider.test.ts`；跨请求 HTTP 验证另行记录               |
| 管理员发布与成员动作 | [service.ts](../worker/src/oidc/service.ts) 维护配置发布/停用、原证明及全局 generation 围栏、一次回调、候选和收据；[oidc-router.ts](../worker/src/oidc/http/oidc-router.ts) 校验自己的浏览器会话、严格请求形状和 per-action cookie                                                | `oidc-linking.test.ts`，真实 D1                                 |
| 身份及配置原子约束   | [app.schema.ts](../worker/src/db/app.schema.ts) 与 [oidc-triggers.ts](../worker/src/db/oidc-triggers.ts) 声明不可转移身份、永久 registry、enabled 停用、退休摘要、确认触发器配置围栏及原子收据                                                                                    | 生成迁移 `0057`–`0059`；`oidc-linking.test.ts`                  |
| 预览与二次确认       | [OIDCIdentities.tsx](../src/components/auth/OIDCIdentities.tsx)、[AdminOIDCProvider.tsx](../src/components/admin/AdminOIDCProvider.tsx) 和 [useOidcMemory.ts](../src/lib/auth/useOidcMemory.ts) 将候选限于原会话和组件内存；[oidcApi.ts](../src/lib/auth/oidcApi.ts) 绑定请求会话 | `src/lib/auth/oidcApi.test.ts`；真实组件浏览器 fixture 另行记录 |

SSO 的两个额外修改入口：

| 改动目标             | 入口及职责                                                                                                                                                                                                                                                                                              | 相关验证                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 匿名登录、因素及签发 | [sign-in.ts](../worker/src/oidc/sign-in.ts) 是自有原生插件，执行严格 Origin、候选、完成和 SDK cookie 桥；[oidc-sign-in-triggers.ts](../worker/src/db/oidc-sign-in-triggers.ts) 原子消费动作/因素并写来源和收据                                                                                          | `oidc-sign-in.test.ts`；生成迁移 `0060`、`0061`                                            |
| 会话来源及界面协调   | [assurance.ts](../worker/src/auth/assurance.ts)、[session.ts](../worker/src/auth/session.ts)、[two-factor.ts](../worker/src/auth/two-factor.ts) 保留并实时核对来源；[OIDCSignIn.tsx](../src/pages/auth/OIDCSignIn.tsx) 只完成自己的候选，[signInLock.ts](../src/lib/auth/signInLock.ts) 协调正常同源 UI | `oidc-session-source.test.ts`、`session-secret-cache.test.ts`、前端 API/锁与实际浏览器验证 |

[session.ts](../worker/src/auth/session.ts) 的签名 memo 仅省 HMAC，不省活 D1 读取；缓存键绑定当前 secret 指纹与原始 cookie，避免 Cloudflare 仅改 bindings 而复用 isolate 时借用旧验签。该密钥轮换边界由 `session-secret-cache.test.ts` 约束，不把 TTL 当作撤权保证。

这里的路径与测试名是维护入口。验证数量和明确边界见专题；生产迁移、配置发布及部署分别核验。绑定不写 SDK `accounts`、不签发登录会话；独立 SSO 插件通过最终 D1 围栏后才使用 SDK cookie helper。

## 权限设计与停止后清理的修改入口

现行公开仓库权限仍使用 read/write/admin 三个布尔值，内部已有命名能力兼容层，未增加可授予的新角色。后续多团队与五级角色的兼容方案、能力矩阵及撤权边界由[权限设计草案](../docs/team-access-design.md)承载，尚未实现新角色表或 API；当前规则与账户资料说明见[权限现状](../docs/permissions.md)。

| 改动目标                 | 入口与职责                                                                                                                                                                                                                               | 验证入口                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 单项、批量和通知候选权限 | [纯权限兼容内核](../worker/src/repositories/permissions.ts)的 permissionsOf/can/withTokenScope；[仓库入口](../worker/src/repositories/service.ts)保留 visibleTo SQL、旧类型重导出及 read scope上限                                       | `repo-permissions.test.ts`、`teams-visibility.test.ts`、`notifications.test.ts` |
| 取消、异常恢复和容量释放 | [共享停止](../worker/src/actions/abandon.ts)确认 Workflow 与每个容器停止，持久推进分批清理；[队列](../worker/src/actions/queue.ts)保留未停止者容量和恢复 alarm；[Actions 路由](../worker/src/actions/http/actions-router.ts)共用这一边界 | `actions.test.ts`、`actions-queue.test.ts`                                      |
| 仓库删除与外部存储清理   | [删除生命周期](../worker/src/repositories/deletion.ts)在停止确认后写点复核新运行，真实 DELETE 后才发布清理 outbox；[仓库路由](../worker/src/repositories/http/repos-router.ts)对停止未完成返回可重试409                                  | `repo-deletion.test.ts`                                                         |
| 原生成员删除             | [受控原子删除](../worker/src/auth/user-deletion.ts)保留原管理中间件，最终写点复查授权和仓库；声明触发器由生成迁移兜底，禁止借账户级联绕过仓库停止                                                                                        | `user-deletion.test.ts`                                                         |
| 执行器重启和最终清理     | [执行器](../worker/src/actions/executor.ts)在 destroy 成功后才记录停止、更新作业并释放；清理重试不重放已完成命令                                                                                                                         | `actions-log-errors.test.ts`                                                    |
| 账户邮箱的查看范围       | [公共成员投影](../worker/src/members/users.ts)的 accountEmailFor 为目录与命名空间共用管理员/本人规则；Git 原始提交邮箱不因此改写                                                                                                         | `commit-emails.test.ts`、`repos-pulls.test.ts`                                  |

这些路径解释清理或拒绝发生在哪里；测试名只表示入口，实际结果另见本轮验收记录。停止失败保留占用，不能从 HTTP 成功或 D1 逻辑终态倒推外部容器已停止。Git 推送主流程的输入与输出未改变。

## 权限兼容数据的修改入口

[受限兼容声明](../worker/src/db/app.schema.ts)增加共享团队/协作者兼容列和state/claims；[数据库守卫](../worker/src/db/access-triggers.ts)在源变更同语句维护归一化claims和generation。[一次性回填](../worker/src/db/access-backfill.ts)由[生成器](../scripts/database/generate-db.mjs)按id/hash登记，只对本次新产物发出，不能靠重放初始化修复缺状态。

[稳定团队读取](../worker/src/repositories/service.ts)与[团队CAS入口](../worker/src/members/http/teams-router.ts)保持原DTO，原生用户与Agent写点继续保留身份/近期证明并将精确namespace冲突映为409。[首次管理员初始化](../worker/src/instance/http/setup-router.ts)使用外层INSERT RETURNING收据，避免把触发器额外写入误认为失败。`access-schema.test.ts`、`access-compat.test.ts`和`access-migration.test.ts`分别验证guard、实际请求竞争及真实D1旧库升级/失败回滚；最终完整测试另行验收。

[授权写点检查](../worker/src/access/write.ts)负责捕获浏览器授权快照并构造同条SQL的最终谓词，当前用于共享团队修改和协作者增删。团队路由保留稳定指针/revision，仓库路由绑定目标URL和不可变id；近期挑战由[认证中间件](../worker/src/auth/recent.ts)统一处理。`access-write.test.ts`、`access-team-write.test.ts`、`access-collaborators.test.ts`覆盖真实D1的证明失效、撤权与目标竞争；浏览器重试边界见`recentAuthentication.test.ts`。

新角色/显式团队尚未开放，其余普通mutation最终授权CAS和旧Worker发布屏障没有据此完成。预检明确识别旧schema、`compat-v1` 与 `runtime-bridge-v1`，未知或部分结构会拒绝；升级根据目标声明和迁移指纹检查支持范围。具体操作与恢复边界见[权限现状](../docs/permissions.md)和[升级维护](../docs/updating.md#access-compatibility-schema)。预检本身不改写 Git 输入输出；过渡运行时新增的 503 拒绝边界已同步 walkthrough。

## 过渡运行时的修改入口

[协议读取](../worker/src/access/runtime.ts)执行有界、无缓存的 D1 状态检查；[HTTP 拒绝响应](../worker/src/access/http/runtime.ts)供 Hono、Git 与 LFS 的独立入口使用。[安装诊断](../worker/src/instance/http/install-router.ts)保留精确 GET/HEAD 元数据探针。[数据库守卫](../worker/src/db/access-runtime-triggers.ts)维护永久状态和单调协议，推进 ACL generation；初始化由生成器管理，不能手工追加迁移。

后台入口分别在 `worker/src/actions/`、`worker/src/merge/`、`worker/src/review/agent-reviewer.ts`、`worker/src/live/hub.ts` 与 `worker/src/cron.ts` 检查，纯停止/销毁路径保留。`access-runtime.test.ts`、`access-runtime-http.test.ts` 和 `access-runtime-background.test.ts` 用真实 D1 覆盖状态守卫与拒绝行为；其余回归按最终日志核验。[Actions 执行器](../worker/src/actions/executor.ts)在缓存步骤之前检查，队列异常后及容量等待/放行时重新读取；`access-runtime-actions.test.ts`覆盖协议推进、队列故障和步骤重放的拒绝边界。入口准入不是每个 await 后的写点围栏，也不能约束未包含检查的旧代码，角色发布仍关闭。

## 权限迁移前的只读检查入口

准备升级团队模型时，先用[维护命令](../scripts/cloudforge/access/access-preflight.ts)选择明确账号/数据库并输出一次诊断；[快照与分析](../scripts/cloudforge/access/access-preflight-data.ts)负责有界结构探测、最终单SELECT复核和异常分类，[结构契约](../scripts/cloudforge/access/access-preflight-definition.ts)校验表约束，[源码协议](../scripts/cloudforge/access/access-protocol.ts)核对目标声明及迁移指纹。[升级入口](../scripts/cloudforge/commands/upgrade.ts)在计划、确认后、迁移前和部署前重查支持范围。[操作说明](../docs/updating.md#legacy-access-preflight)区分退出码、观察摘要与真正迁移授权。节点脚本测试验证目标选择、无写入和升级阻断，`access-preflight.test.ts`的Worker测试用真实D1验证查询及新旧数据边界；CI归属仍由`ci-workflow.test.ts`检查。

这个诊断入口不属于Git请求主链，不更改推送输入输出，也不读取认证秘密或执行迁移。真正升级时，[归属写入约束](../scripts/cloudforge/installation/install-marker.ts)在最终D1写语句中再次核对安装id和nonce，并要求收据；它不把前置观察当作后续覆盖归属的授权。旧Worker回滚屏障和新角色发布仍按[设计专题](../docs/team-access-design.md)继续实施，预检成功不表示它们已上线。

[失败升级恢复](../scripts/cloudforge/commands/upgrade.ts)在读取本地进度后重新核验Cloudflare设置里的安装归属和版本，并与可达站点交叉检查；本地旧状态不能授权覆盖较新部署。`scripts/cloudforge/__tests__/commands/upgrade.test.ts`以本地模拟云接口/执行器覆盖停止和故障恢复路径，具体操作及尚未覆盖的跨机器并发边界见[升级恢复说明](../docs/updating.md#resuming-a-failed-upgrade-safely)。该修补不等于新角色发布屏障已完成。

## 前端页面与组件分层路由

前端消除无层次平铺散落，全量按业务职能与领域划分：

- [Primer 设计系统规范](../DESIGN.md)：Primer 功能色原语、14px 正文锚点、8px 空间网格系统与 6 大基础组件契约。
- `src/pages/`：划分为 `admin/`、`agents/`、`auth/`、`issues/`、`overview/`、`pulls/`、`repo/`、`settings/` 等领域子目录。
- `src/components/`：划分为 `actions/`、`admin/`、`agents/`、`approvals/`、`auth/`、`code/`、`health/`、`issue/`、`notifications/`、`pull/`、`repo/`、[导航壳层与账户菜单](../src/components/shell/AccountMenu.tsx)、`ui/` 等领域子目录。
- `src/lib/`：划分为 `actions/`、`admin/`、`agents/`、`api/`、`approvals/`、`auth/`、`i18n/`、`issues/`、`notifications/`、`pulls/`、`repo/`、`search/`、`theme/`、`ui/`、`utils/` 等工具库子目录。
- 相关验证：`yarn typecheck`、`yarn test:workers src/lib/`（59 文件 815 项测试）及 Playwright 视觉基线（`e2e/visual-baseline.spec.ts`）。

## 独立文档站与指南维护入口

[文档站配置](../docs-site/.vitepress/config.mts)与[依赖声明](../docs-site/package.json)完全隔离于根工作区，不污染核心业务运行时；正文由 `repo-docs/` 单点提供并通过 VitePress include 机制引入。[安全路径拦截](../docs-site/.vitepress/guide-links.mts)将仓库源文件引用转化为安全精确路径；全本地自托管离线字体位于 `docs-site/.vitepress/theme/fonts/`，配合 Shadow DOM 昼夜切换开关与 Anime.js 渐进动效引擎（均支持无 JS 与减少动效降级）。

验证入口：`yarn --cwd docs-site docs:build` 与文档包结构校验；实际执行结果见[指南变更记录](change-log.md)。

## 覆盖范围

行为讲解覆盖 Git HTTPS 推送入口、引用保护、Artifacts 交接和持久化推送事件；业务域与脚本表提供目录导航，不扩大行为审计范围。PR 审查、合并、Actions 执行器、OAuth/MFA、MCP、安装器、SPA 与其他数据库模块留给既有 docs 专题，本包不声称完整架构覆盖。认证策略的预览、受限会话、OAuth 撤销和离线恢复边界见 [认证专题](../docs/authentication.md#管理员认证策略)。提交、远端推送与生产部署分别核验。

生成物、依赖安装目录、临时日志及第三方供应商源码不作为本次第一方模块地图。修改范围外机制前应重新调查，不能从本页推断兼容性。

证据状态：除特别标注外，本页基于当前源码已确认。

## 安全边界的交接入口

命令执行前被拒绝时，平台应保留已经完成的步骤；回退 PR 应只撤销原 PR 引入的内容。修改这些交接时，
先查看以下证据归属，再检查旧数据和旧调用方是否仍满足相同约束。

| 场景                     | 维护入口                                                                                                                                          | 验证入口                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 执行前准入与重启         | `worker/src/actions/job-runner.ts` 返回可序列化的拒绝结果，`worker/src/actions/executor.ts` 将其持久记为失败；未知容器中断仍按既有策略处理        | `actions-boundaries-security.test.ts`                                                                 |
| 精确回退和发布恢复       | `worker/src/pulls/service.ts` 从 recorded landing intent 读取准确 base；`worker/src/releases/service.ts` 复核未记账落地及最终发布快照，不删除标签 | `security-landing.test.ts`                                                                            |
| 撤销单条审查决定         | `worker/src/review/flags.ts` 在写点核对完整决定快照和仍开放的 PR，拒绝迟到请求清掉新决定                                                          | `undo-concurrency.test.ts`                                                                            |
| 脚本和安装器的 Yarn 启动 | `scripts/githooks/yarn-command.mjs` 共享纯解析逻辑；`run-yarn.mjs` 保留钩子入口；`scripts/cloudforge/platform/runner.ts` 保留异步 stdin/stdout    | `scripts/cloudforge/__tests__/platform/runner.test.ts`、`scripts/githooks/__tests__/run-yarn.test.ts` |

旧的多父落地若没有准确基点证据，会拒绝自动回退。读不到 Git 对象或历史范围不完整时，合并检查要求重试，
不推断为“没有共享提交”。容器系统包与全局 npm 的依赖核验见[开发说明](../docs/development.md#process-and-runner-dependency-boundaries)。
