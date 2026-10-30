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

## 认证策略的修改路由

需要修改强制 MFA 时，先读[认证专题](../docs/authentication.md#管理员认证策略)。下表只定位本次复核的策略边界，不扩展为 OAuth、MFA 或 SPA 全目录地图。

| 改动目标                     | 入口及职责                                                                                                                                                                                                                                                            | 相关验证                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 浏览器受限通道与原生认证入口 | [策略判断](../worker/src/auth/policy.ts) 的 `evaluatePolicyAccess`、`enforceBrowserPolicy`、`requireNativePolicy`；[认证流程](../worker/src/auth/two-factor.ts) 在真实验证完成后的写点核对策略版本                                                                    | `authentication-policy-session.test.ts`                                |
| 管理员预览与执行             | [预览和条件写](../worker/src/auth/policy-management.ts) 的 `previewPolicy`、`applyPolicy`；[声明触发器](../worker/src/db/auth-policy-triggers.ts) 原子处理 OAuth 撤销、预览消费及审计；[管理路由](../worker/src/routers/authentication-policy-router.ts) 校验请求形状 | `authentication-policy.test.ts`、`authentication-policy-audit.test.ts` |
| OAuth 凭据与旧授权拒绝       | [授权代际](../worker/src/auth/oauth-grants.ts)、[MCP 身份](../worker/src/mcp/oauth-session.ts) 与[数据库写入围栏](../worker/src/db/oauth-grant-triggers.ts) 共同核对当前策略和授权代际                                                                                | `authentication-policy-oauth.test.ts`                                  |
| 页面引导与确认               | [应用入口](../src/App.tsx) 根据通道引导；[管理员表单](../src/components/AdminAuthenticationPolicy.tsx) 先预览再确认；[账户安全页](../src/pages/SettingsSecurity.tsx) 承担首次绑定和恢复码保存                                                                         | `src/lib/authenticationPolicy.test.ts`；实际组件验证另行记录           |

表中的测试名表示验证入口，不表示本轮已全部运行通过。新增数据库结构来自生成迁移 `0056`，迁移和部署分别授权与验证。

## OIDC 显式绑定的修改路由

完整行为见 [OIDC 显式身份绑定](../docs/oidc.md)。下表仅定位已实现绑定及配置发布，不扩展成完整登录体系；独立 SSO 登录仍待做。

| 改动目标             | 入口及职责                                                                                                                                                                                                                                                   | 相关验证                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 配置和外部协议       | [provider.ts](../worker/src/oidc/provider.ts) 校验公开配置、secret 摘要、固定回调、PKCE、ID token、出站和完成数据缓存；[errors.ts](../worker/src/oidc/errors.ts) 给出安全错误                                                                                | `oidc-provider.test.ts`；跨请求 HTTP 验证另行记录          |
| 管理员发布与成员动作 | [service.ts](../worker/src/oidc/service.ts) 维护配置发布/停用、原证明及全局 generation 围栏、一次回调、候选和收据；[oidc-router.ts](../worker/src/routers/oidc-router.ts) 校验自己的浏览器会话、严格请求形状和 per-action cookie                             | `oidc-linking.test.ts`，真实 D1                            |
| 身份及配置原子约束   | [app.schema.ts](../worker/src/db/app.schema.ts) 与 [oidc-triggers.ts](../worker/src/db/oidc-triggers.ts) 声明不可转移身份、永久 registry、enabled 停用、退休摘要、确认触发器配置围栏及原子收据                                                               | 生成迁移 `0057`–`0059`；`oidc-linking.test.ts`             |
| 预览与二次确认       | [OIDCIdentities.tsx](../src/components/OIDCIdentities.tsx)、[AdminOIDCProvider.tsx](../src/components/AdminOIDCProvider.tsx) 和 [useOidcMemory.ts](../src/lib/useOidcMemory.ts) 将候选限于原会话和组件内存；[oidcApi.ts](../src/lib/oidcApi.ts) 绑定请求会话 | `src/lib/oidcApi.test.ts`；真实组件浏览器 fixture 另行记录 |

这里的路径与测试名是维护入口。验证数量和明确边界见专题；生产迁移、配置发布及部署分别核验。该绑定不写 SDK `accounts`、不签发登录会话。

## 覆盖范围

覆盖 Git HTTPS 推送入口、引用保护、Artifacts 交接和持久化推送事件；只追踪这些目录内与推送有关的文件。PR 审查、合并、Actions 执行器、OAuth/MFA、MCP、安装器、SPA 与其他数据库模块留给既有 docs 专题，本包不声称完整架构覆盖。认证策略的预览、受限会话、OAuth 撤销和离线恢复边界见 [认证专题](../docs/authentication.md#管理员认证策略)。提交、远端推送与生产部署分别核验。

生成物、依赖安装目录、临时日志及第三方供应商源码不作为本次第一方模块地图。修改范围外机制前应重新调查，不能从本页推断兼容性。

证据状态：除特别标注外，本页基于当前源码已确认。
