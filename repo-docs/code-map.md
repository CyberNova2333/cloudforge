<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

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

认证表的生成入口在[项目命令](../package.json)，`yarn auth:update` 使用本地锁定的 CLI，再补齐 fork notice 并格式化。工具依赖与业务依赖一起纳入锁文件和审计；生成命令不执行数据库迁移。版本与操作边界见[开发说明](../docs/development.md#ci)。

## 认证策略的修改路由

需要修改强制 MFA 时，先读[认证专题](../docs/authentication.md#管理员认证策略)。下表只定位本次复核的策略边界，不扩展为 OAuth、MFA 或 SPA 全目录地图。

| 改动目标                     | 入口及职责                                                                                                                                                                                                                                                            | 相关验证                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 浏览器受限通道与原生认证入口 | [策略判断](../worker/src/auth/policy.ts) 的 `evaluatePolicyAccess`、`enforceBrowserPolicy`、`requireNativePolicy`；[认证流程](../worker/src/auth/two-factor.ts) 在真实验证完成后的写点核对策略版本                                                                    | `authentication-policy-session.test.ts`                                |
| 管理员预览与执行             | [预览和条件写](../worker/src/auth/policy-management.ts) 的 `previewPolicy`、`applyPolicy`；[声明触发器](../worker/src/db/auth-policy-triggers.ts) 原子处理 OAuth 撤销、预览消费及审计；[管理路由](../worker/src/routers/authentication-policy-router.ts) 校验请求形状 | `authentication-policy.test.ts`、`authentication-policy-audit.test.ts` |
| OAuth 凭据与旧授权拒绝       | [授权代际](../worker/src/auth/oauth-grants.ts)、[MCP 身份](../worker/src/mcp/oauth-session.ts) 与[数据库写入围栏](../worker/src/db/oauth-grant-triggers.ts) 共同核对当前策略和授权代际                                                                                | `authentication-policy-oauth.test.ts`                                  |
| 页面引导与确认               | [应用入口](../src/App.tsx) 根据通道引导；[管理员表单](../src/components/AdminAuthenticationPolicy.tsx) 先预览再确认；[账户安全页](../src/pages/SettingsSecurity.tsx) 承担首次绑定和恢复码保存                                                                         | `src/lib/authenticationPolicy.test.ts`；实际组件验证另行记录           |

表中的测试名表示验证入口，不表示本轮已全部运行通过。新增数据库结构来自生成迁移 `0056`，迁移和部署分别授权与验证。

## OIDC 绑定与 SSO 的修改路由

完整行为见 [OIDC 身份绑定与 SSO](../docs/oidc.md)。下表只定位显式绑定、配置发布、已有绑定登录及来源撤权，不扩展为整个认证目录调查。

| 改动目标             | 入口及职责                                                                                                                                                                                                                                                   | 相关验证                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 配置和外部协议       | [provider.ts](../worker/src/oidc/provider.ts) 校验公开配置、secret 摘要、固定回调、PKCE、ID token、出站和完成数据缓存；[errors.ts](../worker/src/oidc/errors.ts) 给出安全错误                                                                                | `oidc-provider.test.ts`；跨请求 HTTP 验证另行记录          |
| 管理员发布与成员动作 | [service.ts](../worker/src/oidc/service.ts) 维护配置发布/停用、原证明及全局 generation 围栏、一次回调、候选和收据；[oidc-router.ts](../worker/src/routers/oidc-router.ts) 校验自己的浏览器会话、严格请求形状和 per-action cookie                             | `oidc-linking.test.ts`，真实 D1                            |
| 身份及配置原子约束   | [app.schema.ts](../worker/src/db/app.schema.ts) 与 [oidc-triggers.ts](../worker/src/db/oidc-triggers.ts) 声明不可转移身份、永久 registry、enabled 停用、退休摘要、确认触发器配置围栏及原子收据                                                               | 生成迁移 `0057`–`0059`；`oidc-linking.test.ts`             |
| 预览与二次确认       | [OIDCIdentities.tsx](../src/components/OIDCIdentities.tsx)、[AdminOIDCProvider.tsx](../src/components/AdminOIDCProvider.tsx) 和 [useOidcMemory.ts](../src/lib/useOidcMemory.ts) 将候选限于原会话和组件内存；[oidcApi.ts](../src/lib/oidcApi.ts) 绑定请求会话 | `src/lib/oidcApi.test.ts`；真实组件浏览器 fixture 另行记录 |

SSO 的两个额外修改入口：

| 改动目标             | 入口及职责                                                                                                                                                                                                                                                                                    | 相关验证                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 匿名登录、因素及签发 | [sign-in.ts](../worker/src/oidc/sign-in.ts) 是自有原生插件，执行严格 Origin、候选、完成和 SDK cookie 桥；[oidc-sign-in-triggers.ts](../worker/src/db/oidc-sign-in-triggers.ts) 原子消费动作/因素并写来源和收据                                                                                | `oidc-sign-in.test.ts`；生成迁移 `0060`、`0061`                                            |
| 会话来源及界面协调   | [assurance.ts](../worker/src/auth/assurance.ts)、[session.ts](../worker/src/auth/session.ts)、[two-factor.ts](../worker/src/auth/two-factor.ts) 保留并实时核对来源；[OIDCSignIn.tsx](../src/pages/OIDCSignIn.tsx) 只完成自己的候选，[signInLock.ts](../src/lib/signInLock.ts) 协调正常同源 UI | `oidc-session-source.test.ts`、`session-secret-cache.test.ts`、前端 API/锁与实际浏览器验证 |

[session.ts](../worker/src/auth/session.ts) 的签名 memo 仅省 HMAC，不省活 D1 读取；缓存键绑定当前 secret 指纹与原始 cookie，避免 Cloudflare 仅改 bindings 而复用 isolate 时借用旧验签。该密钥轮换边界由 `session-secret-cache.test.ts` 约束，不把 TTL 当作撤权保证。

这里的路径与测试名是维护入口。验证数量和明确边界见专题；生产迁移、配置发布及部署分别核验。绑定不写 SDK `accounts`、不签发登录会话；独立 SSO 插件通过最终 D1 围栏后才使用 SDK cookie helper。

## 权限设计与停止后清理的修改入口

现行公开仓库权限仍使用 read/write/admin 三个布尔值，内部已有命名能力兼容层，未增加可授予的新角色。后续多团队与五级角色的兼容方案、能力矩阵及撤权边界由[权限设计草案](../docs/team-access-design.md)承载，尚未实现新角色表或 API；当前规则与账户资料说明见[权限现状](../docs/permissions.md)。

| 改动目标                 | 入口与职责                                                                                                                                                                                                                          | 验证入口                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 单项、批量和通知候选权限 | [纯权限兼容内核](../worker/src/lib/repo-permissions.ts)的 permissionsOf/can/withTokenScope；[仓库入口](../worker/src/lib/repos.ts)保留 visibleTo SQL、旧类型重导出及 read scope上限                                                 | `repo-permissions.test.ts`、`teams-visibility.test.ts`、`notifications.test.ts` |
| 取消、异常恢复和容量释放 | [共享停止](../worker/src/actions/abandon.ts)确认 Workflow 与每个容器停止，持久推进分批清理；[队列](../worker/src/actions/queue.ts)保留未停止者容量和恢复 alarm；[Actions 路由](../worker/src/routers/actions-router.ts)共用这一边界 | `actions.test.ts`、`actions-queue.test.ts`                                      |
| 仓库删除与外部存储清理   | [删除生命周期](../worker/src/lib/repo-deletion.ts)在停止确认后写点复核新运行，真实 DELETE 后才发布清理 outbox；[仓库路由](../worker/src/routers/repos-router.ts)对停止未完成返回可重试409                                           | `repo-deletion.test.ts`                                                         |
| 原生成员删除             | [受控原子删除](../worker/src/auth/user-deletion.ts)保留原管理中间件，最终写点复查授权和仓库；声明触发器由生成迁移兜底，禁止借账户级联绕过仓库停止                                                                                   | `user-deletion.test.ts`                                                         |
| 执行器重启和最终清理     | [执行器](../worker/src/actions/executor.ts)在 destroy 成功后才记录停止、更新作业并释放；清理重试不重放已完成命令                                                                                                                    | `actions-log-errors.test.ts`                                                    |
| 账户邮箱的查看范围       | [公共成员投影](../worker/src/lib/users.ts)的 accountEmailFor 为目录与命名空间共用管理员/本人规则；Git 原始提交邮箱不因此改写                                                                                                        | `commit-emails.test.ts`、`repos-pulls.test.ts`                                  |

这些路径解释清理或拒绝发生在哪里；测试名只表示入口，实际结果另见本轮验收记录。停止失败保留占用，不能从 HTTP 成功或 D1 逻辑终态倒推外部容器已停止。Git 推送主流程的输入与输出未改变。

## 权限兼容数据的修改入口

[受限兼容声明](../worker/src/db/app.schema.ts)增加共享团队/协作者兼容列和state/claims；[数据库守卫](../worker/src/db/access-triggers.ts)在源变更同语句维护归一化claims和generation。[一次性回填](../worker/src/db/access-backfill.ts)由[生成器](../scripts/generate-db.mjs)按id/hash登记，只对本次新产物发出，不能靠重放初始化修复缺状态。

[稳定团队读取](../worker/src/lib/repos.ts)与[团队CAS入口](../worker/src/routers/teams-router.ts)保持原DTO，原生用户与Agent写点继续保留身份/近期证明并将精确namespace冲突映为409。[首次管理员初始化](../worker/src/routers/setup-router.ts)使用外层INSERT RETURNING收据，避免把触发器额外写入误认为失败。`access-schema.test.ts`、`access-compat.test.ts`和`access-migration.test.ts`分别验证guard、实际请求竞争及真实D1旧库升级/失败回滚；最终完整测试另行验收。

新角色/显式团队尚未开放，普通mutation最终授权CAS和旧Worker发布屏障没有据此完成。预检继续只接受旧schema，当前兼容库会拒绝；具体操作与恢复边界见[权限现状](../docs/permissions.md)和[升级维护](../docs/updating.md#access-compatibility-schema)。主Git推送输入输出未改，本入口不改写walkthrough。

## 权限迁移前的只读检查入口

准备升级团队模型时，先用[维护命令](../scripts/cloudforge/access-preflight.ts)选择明确账号/数据库并输出一次诊断；[快照与分析](../scripts/cloudforge/access-preflight-data.ts)负责有界单SELECT、旧模型判定和异常分类。[操作说明](../docs/updating.md#legacy-access-preflight)区分退出码、观察摘要与真正迁移授权。节点脚本测试验证目标选择和无写入，`access-preflight.test.ts`的Worker测试用真实D1验证查询及旧数据边界；CI归属仍由`ci-workflow.test.ts`检查。

这个入口不属于Git请求主链，不更改推送输入输出，也不读取认证秘密或执行迁移。旧Worker回滚屏障和新角色发布仍按[设计专题](../docs/team-access-design.md)继续实施，预检成功不表示它们已上线。

## 覆盖范围

覆盖 Git HTTPS 推送入口、引用保护、Artifacts 交接和持久化推送事件；只追踪这些目录内与推送有关的文件。PR 审查、合并、Actions 执行器、OAuth/MFA、MCP、安装器、SPA 与其他数据库模块留给既有 docs 专题，本包不声称完整架构覆盖。认证策略的预览、受限会话、OAuth 撤销和离线恢复边界见 [认证专题](../docs/authentication.md#管理员认证策略)。提交、远端推送与生产部署分别核验。

生成物、依赖安装目录、临时日志及第三方供应商源码不作为本次第一方模块地图。修改范围外机制前应重新调查，不能从本页推断兼容性。

证据状态：除特别标注外，本页基于当前源码已确认。
