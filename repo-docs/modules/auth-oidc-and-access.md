<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# 身份认证、OIDC 与访问边界

CloudForge 在请求入口、仓库权限、外部自动化接口与数据库协议之间设置了多层显式闸门。与 [一次真实主流程](../walkthroughs/one-real-run.md) 中的推送认证相同，网页、API、OIDC 回调和 `/mcp` 并不共享同一套凭据语义，任何身份（人类会话、个人访问令牌、部署令牌、OAuth 客户端或无登录评审 Agent）都受独立降级与撤权边界约束。

## 会话直读、强制 MFA 与 OIDC 登录隔离

除 `/api/auth/*` 外，普通业务与页面请求直接通过 `worker/src/auth/session.ts` 查询 D1 `sessions` 表并常量时间校验 Cookie HMAC（依据 `BASE_URL` 协议优先读取 `__Secure-` 前缀），避开每次请求重复初始化完整的 better-auth 链路。实例管理员可在后台开启强制 MFA 策略（`worker/src/auth/policy.ts`、`worker/src/auth/recent.ts`）：未绑定第二因素的成员在浏览受保护页面时会被锁入安全绑定页，高风险管理操作（修改安全策略、切换共享团队、写入仓库敏感设置或 OAuth 授权同意）还要求近期本地密码与双因子证明。

```http
POST /mcp HTTP/1.1
Authorization: Bearer <oauth2_jwt_access_token>
Content-Type: application/json
```

外部单点登录（`worker/src/oidc/service.ts`、`worker/src/oidc/http/oidc-router.ts`）采用“先管理员显式启用并提升配置代际，再由已有成员在近期本地验证下绑定，最后方可通过 OIDC 发起登录”的渐进模式。SSO 登录回调先落入临时候选并经过二次确认和本地 MFA 检验后才签发会话，且在会话上保留 `sso` 来源标记；管理员随时可发布 `enabled = false` 立即失效既有 OIDC 登录能力。

## 兼容权限内核、协议准入与 MCP 网关

当前仓库访问控制由 `worker/src/repositories/service.ts`（`permissionsFor`、`permissionsForMany`、`visibleTo`）与 `worker/src/repositories/permissions.ts` 统一决定：私人仓库仅所有者、直接协作者与站点管理员可见（无权访问统一返回 404 不泄露存在性），共享团队目前作为全局唯一命名空间运行（团队仓库默认为 `internal`，仅仓库管理员可显式改为 `public`，禁止 `private`）。为给未来的多团队五级角色演进铺路，所有 HTTP、Git/LFS 与后台入口在鉴权前均执行 `worker/src/access/runtime.ts`：读取 D1 永久单例 `access_runtime_state` 验证当前代码满足最低协议与模式（`compat-v1` / `runtime-bridge-v1`），任何缺行、未知模式或更高版本协议均返回不可缓存的 503。

| 访问主体或接口                   | 允许范围                                                      | 拒绝与隔离边界                                                             |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 匿名或已封禁账户                 | 仅浏览并克隆 `public` 仓库                                    | 私有与 `internal` 仓库统一返回 404；封禁立即阻断 PAT 与部署令牌            |
| Reviewer Agent 账号              | 拥有个人配置仓库并通过系统调用写评审结论                      | `worker/src/auth/index.ts` 禁止创建任何人类会话、PAT 或 `/mcp` 凭据        |
| 普通 OAuth MCP 客户端            | 经 `worker/src/mcp/oauth-session.ts` 验签后调用 31 个标准工具 | 不列出也不允许调用 `approve_*` / `dismiss_*`，断开连接即删 consent 与令牌  |
| 显式标记的 `mcp_moderators` 应用 | 在标准工具外解锁 3 个批准/驳回工具并记录 `via <app>`          | 每次 `initialize` / `tools/list` / `tools/call` 实时查库并强制每次弹窗授权 |

`/mcp` 端点（`worker/src/mcp/index.ts`）以无状态 Streamable HTTP JSON-RPC 2.0 对外提供服务，同时通过 `worker/src/mcp/well-known.ts` 暴露 RFC 9728 / RFC 8414 自动发现文档，使标准桌面或终端编码代理可在用户点击授权同意后获得作用域为 `<origin>/mcp` 的 JWT 访问令牌；为兼顾早期迁移脚本，协议层仍对入站 `gitorange_*` 工具名做兼容映射，但在 `tools/list` 中只公布 `cloudforge_*`。关于这些接口在各个目录中的落点，可对照 [代码地图](../code-map.md) 与 [术语表](../glossary.md) 核查。

证据状态：除特别标注外，本页基于当前源码已确认。
