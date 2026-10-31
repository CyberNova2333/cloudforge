<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# OIDC 身份绑定与 SSO 登录

已有成员先在账户安全页显式绑定 OIDC 身份，再由管理员明确发布登录能力，才能用该身份登录。绑定和登录是两个独立动作：绑定不创建会话，登录只认已有活动绑定，不按邮箱注册或合并账户。已启用本地因素的成员仍须完成 TOTP 或恢复码验证；外部身份不能替代近期本地密码证明。

本文按 `32abd5c19562f17624ec0383fa99daeb5a213a5a` 基线上的本轮源码同步。绑定与 SSO 均使用自有协议和状态机；完整项目验收、生产迁移、部署和真实企业 IdP 验证分别记录，不能由接口或页面存在推断已经上线。

## 阶段与交付边界

| 阶段                 | 当前行为                                                                                                   | 完成边界                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| SDK 关联面收紧       | `accountLinking.enabled=false` 与 `disableImplicitLinking=true` 禁止默认新增联结；已有解除操作保留近期验证 | 不将这些开关视为禁止所有已有精确身份登录的通用开关               |
| 显式绑定             | 自有协议、管理员配置发布、成员预览与候选二次确认、查看及撤销绑定                                           | 不自动注册、不按同邮箱合并、不转移身份、不开放独立 SSO 登录      |
| SSO 登录             | 自有匿名动作、候选确认、本地 MFA 与 SDK 会话签发                                                           | 仅已有绑定；显式发布登录能力，来源持续核验，敏感操作仍需本地密码 |
| 企业策略扩展（后续） | 多 provider、受信任外部 MFA、SSO-only 和通行密钥仍属规划                                                   | 分别设计发布、强度映射和最后管理员恢复                           |

没有向 Better Auth 注册社会化或 `genericOAuth` provider；绑定写自有表，不写 SDK 的 `accounts`。自有 `/oidc-sign-in` 原生插件在最终授权成功后使用 SDK session/cookie helpers，不开放 SDK 的通用社会化登录或直接 ID token 入口。[Better Auth 账户关联文档](https://better-auth.com/docs/concepts/users-accounts#account-linking) 提供开关背景，实际仍以本地 `1.7.7` 源码为准：禁用账户关联不等于禁用已有精确身份登录，`genericOAuth.config` 也不转发 `disableIdTokenSignIn`，因此不能用配置名代替入口围栏。

## 一个成员实际会经历什么

假设本地成员 `alice` 已启用 TOTP，并在五分钟内完成密码与因子验证。她要绑定 `issuer=https://identity.example/tenant`、`sub=subject-17`。

1. 账户安全页显示当前成员、提供商、issuer 和绑定范围。服务端签发至多两分钟有效的预览，绑定原会话、提供商配置和全部授权代际，并受原近期证明到期时间限制。
2. 她勾选确认并开始。服务端原子消费预览，产生独立随机 state、PKCE verifier、nonce 和 cookie 值。协议动作至多十分钟，不能超过原五分钟证明的剩余寿命。
3. 提供商 GET 回调到 `/api/auth/oidc/callback/<providerId>`。服务端验证 state、该动作的 cookie 和原会话，原子领取回调，再交换授权码并校验 ID token。原授权仍有效时才写入候选，此时尚未绑定。
4. 页面从同一会话的 API 读取候选，显示 issuer、sub、邮箱和名称。邮箱及名称仅作纯文本说明。候选最多两分钟，且不超过动作、原证明与 ID token 的到期时间。
5. 她再次勾选并确认。条件写、唯一绑定和操作收据在 D1 原子完成。重复确认只读取原收据；网络结果不确定时查询实际状态，不自动重发写请求。
6. 浏览器继续使用原本地会话。绑定没有完成密码验证，也不生成新会话或一次性因子证明。

若本地会话退出、账户切换、密码或因子代际改变、恢复码重生成、策略或已发布提供商改变，旧动作失效。重新认证后必须重新预览，不能给旧动作补一份新证明。受限 MFA 会话、模拟身份、PAT、MCP 会话及 Agent 用户不能使用此流程。

## 已绑定成员如何登录

1. 登录页仅在当前部署与 D1 发布配置一致、`loginEnabled=true` 且浏览器支持所需 Web Locks 时显示可用入口。登录 start 是严格本站 Origin 的匿名 POST；已有活会话时拒绝静默替换账户。
2. 服务端保存有期限的匿名动作，生成专用 state、nonce 和 S256 verifier。HTTPS 证明 cookie 使用每动作独立 `__Host-cloudforge.oidc-login.<stateHash>`，Secure、HttpOnly、SameSite=Lax、Path=/、无 Domain，阻止同站子域植入 Domain cookie；仅 loopback HTTP 使用无前缀开发模式。
3. 提供商 GET 回调 `/api/auth/oidc-sign-in/callback/<providerId>`。服务端单次领取、交换授权码并验证 ID token，只按活动 provider/issuer/sub 查已有绑定及本地成员。回调只保存候选，固定跳到 `/login/oidc?actionId=<uuid>`，不在 URL 放 code、state、token 或原始错误。
4. 完成页凭本动作 cookie 查询实际候选，明确显示本地账户。无因素者也须主动确认；已启用本地因素者无论实例策略开关，都要输入本地 TOTP 或恢复码。实例要求 MFA 而成员尚未绑定时返回 `enrollment_required`，不发成员会话，指引用本地密码完成现有因素绑定流程。
5. complete 的最终声明触发器再次检查原配置、策略、绑定 revision、用户和因素代际，原子消费动作与因素，并写正式 session 和结果收据。随后才用 SDK 签发 HttpOnly session cookie；未知结果只读收据并核对 SDK 的 userId/sessionId，不自动重发 complete。
6. 普通访问记录 OIDC 主因子及真实本地因素时间。`authTime` 是本应用验证完成时间，ID token 的 `iat`、IdP `auth_time`、`amr` 或 `acr` 都不是本地密码证明。敏感操作仍须五分钟内真实本地密码与已启用因素联合重验。

匿名动作最多十分钟，识别后的候选最多两分钟，且不能超过原动作和 ID token 剩余有效期；限流、库存和清理由 D1 原子约束及有界清理负责。正式会话使用本地 session 寿命，不靠外部 token 续期，也不因短期动作收据清理而重新发 token。状态与收据只给本动作证明或已签发的同一会话读取。

前端在相同 origin 的 Web Locks 下串行完成 SSO 与本地密码/因素登录，并在锁内复查当前会话。成功后整页跳转以清理旧账户缓存。不支持 Web Locks 时继续提供密码登录，SSO 退回该路径。锁只协调正常同源密码/因素及 SSO 界面；邮件验证等原生自动登录的并发不在本轮锁覆盖内。后端仍靠原证明、会话删除和代际拒绝迟到写；不声称控制任意原生 HTTP 请求的响应到达顺序。故意竞争的原始 API 请求可能令旧 cookie 无效并要求重新登录。

成功的本地退出登录会取消该请求实际呈现且验证有效的本机旧 SSO 动作；成功的独立密码/因素登录也会使这些旧动作不能迟到复活。跨站拒绝或失败操作不触发清理。这不是退出外部 IdP，也不代表登出所有其他浏览器。

## 部署配置与管理员发布

`OIDC_PROVIDER` 是公开的 JSON 字符串，默认空字符串表示当前部署未配置，不表示实例已经发布停用。`OIDC_CLIENT_SECRET` 是独立 Worker secret，不放入该 JSON。格式和操作步骤见 [配置](configuration.md#oidc-identity-linking)。当前只支持一个部署配置，固定授权码、S256、`openid profile email` 和 `client_secret_basic`；不申请离线访问或刷新令牌。

| 字段             | 约束                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `id`             | 1–50 位小写字母、数字、下划线或短横线，首位为字母或数字；不可复用的提供商身份           |
| `name`           | 1–100 字符，无控制字符；用于公开界面                                                    |
| `issuer`         | 固定 HTTPS DNS URL，无凭据、query 或 fragment；与发现文档及 ID token 的 issuer 精确一致 |
| `clientId`       | 1–1024 字符，无控制字符                                                                 |
| `version`        | 正的安全整数；已登记 id 的任何有效配置变更须严格提升版本                                |
| `loginEnabled`   | 可选严格 boolean，默认 false；true 开放已有绑定登录，须升版并明确发布                   |
| `allowedOrigins` | 可选，最多八个额外 HTTPS DNS origin；issuer origin 自动加入，供发现结果的端点校验       |

回调由 `BASE_URL` 加固定路径生成，不接受请求或提供商指定的回调地址。绑定使用 `/api/auth/oidc/callback/<id>`；只有 `loginEnabled=true` 才公开独立 `/api/auth/oidc-sign-in/callback/<id>`。部署者须在 IdP 分别登记完全相同的 GET 地址。生产登录要求 HTTPS `BASE_URL`，仅 localhost、`127.0.0.1` 和 `[::1]` 可用本地 HTTP；提供商端点始终要求 HTTPS DNS。

`loginEnabled` 可选且默认 false。省略或显式 false 保持旧绑定配置的摘要算法和字节顺序，因此升级不会自动启用登录，也不令旧绑定配置隐式失配。true 将登录能力及登录回调加入摘要；已登记 provider 必须提高 version 并由管理员明确预览/发布，不能沿用只授予绑定的旧发布。公开 DTO 的 `loginCallbackUrl` 在关闭时为 null。

写入环境变量或 secret 并部署后，配置仍须由管理员在站点设置页预览、确认和发布。管理员需要完整的真实浏览器会话，以及五分钟内的本地密码和已启用因子证明。预览绑定会话、原证明、待发布配置及全局 `configGeneration`；最终 SQL 写点再次检查管理员身份和这些条件。公开确认摘要是随机操作能力，不是 secret 或其摘要。

`oidc_providers` 永久登记 id 与 issuer，`oidc_configuration` 记录当前配置、`enabled`、`login_enabled` 和全局 generation。已有 id 不能换 issuer、降低或复用版本；切换到其他 id 后再切回，或停用后重新启用，也须提升原 id 的版本。更换 issuer 必须用新 id。内部完整摘要覆盖 secret、名称、客户端、允许的 origin、版本和回调；secret 轮换或 `BASE_URL` 改变同样须提升版本并重新发布。

发布原子增加全局 generation。旧 Worker 配置、预览、等待回调或候选即使仍有缓存，也不能通过最终 D1 围栏。可靠停用必须由仍有效的本地管理员在近期证明下预览并确认发布（管理员 API `/retire-preview`、`/retire`）。声明触发器将 D1 `enabled` 置为 false、把当前 digest 改成 `retired:<actionId>`、推进 generation，并取消及清理所有在途绑定动作。该撤权不依赖当前部署的 provider 配置或 secret 有效。只清空环境变量不能替代发布停用：它仅令当前部署不提供协议，旧 Worker 或已开始交换的动作仍可能持有原配置。

停用保留 registry、已绑定身份和 tombstone，成员仍能查看和按近期验证规则撤销自己的绑定。当前部署配置缺失或无效时，状态接口安全返回 `ready=false`，保留查看、撤销和管理员停用能力；管理员状态以 `active.enabled` 表示已发布启停、`active.loginEnabled` 表示已发布登录能力，配置错误另见 `configurationError`。不能把“未配置”误读为“已全局停用”。重新启用须使用更高版本并再次发布。当前没有动态多 provider 或通用 D1 配置编辑入口。

安装器未新增 OIDC flags，默认仍为空配置。操作者明确选择接入后再手写公开配置、设置 secret、审查迁移并部署，然后由管理员发布。生成迁移 `0057` 建立绑定结构，`0058` 增加停用，`0059` 补充退休 digest 和绑定确认围栏；本轮 SSO 的生成迁移 `0060`、`0061` 增加登录动作、私有会话来源及原子签发/来源约束。生产迁移和部署均须另行授权，不由本地验证自动执行。

## 身份唯一性与撤销

权威键是大小写敏感的 `(issuer, sub)`。邮箱、显示名、用户名或域名不能合并账户；回传邮箱也不成为本地已验证邮箱。每个成员同一 provider 至多一个活动绑定。

身份不能移交给另一成员。撤销保留记录和 revision，仅原成员能重新走完整流程恢复自己的同一身份；账户删除后 owner 置空，留下不能被新账户接管的 tombstone。新建同名或同邮箱账户不会继承绑定。声明触发器限制身份键、provider id、owner 和版本变动，并在撤销时取消相关在途动作。

撤销检查自己的完整会话、近期证明和 binding revision，部署配置移除后仍可执行。取消自己的未完成动作不要求再次提供近期证明，但仍检查当前有效会话。取消、失败及进入候选会清理动作的 state/cookie 摘要和加密状态；超时按状态和原期限拒绝使用，不表示有独立定时任务即时删除过期行。

## 绑定动作与最终写点

`oidc_link_actions` 按成员和动作种类保留一个有界操作槽；新预览替换旧槽，使旧动作 ID 失效。服务端只保存 state 与 cookie 的 SHA256。verifier 和 nonce 使用 `BETTER_AUTH_SECRET` 派生的专用 AES-GCM 密钥加密，AAD 绑定动作、成员、会话和完整提供商摘要。

| 写点           | 原子检查与变化                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 预览与 start   | 活会话、未封禁且非 Agent/模拟身份、唯一密码凭据、原密码/因子证明、credential/factor/recovery/policy 代际及配置 generation；start 单次消费预览 |
| 回调领取       | 原成员/会话、state/cookie 摘要、未过期动作、当前配置及原证明；CAS 从 `await_callback` 进入 `exchanging`，授权码只交换一次                     |
| 候选写入       | 协议成功后再检查全部原授权条件和 generation，限制候选期限；只写最小身份信息                                                                   |
| 最终确认       | 原会话、原证明、候选和配置仍有效；触发器原子写入唯一绑定及 binding id/revision 收据                                                           |
| 配置发布与撤销 | 分别复核管理员或 owner、预览/CAS revision 和原授权快照；审计不含 token、secret 或完整协议响应                                                 |

绑定确认触发器还独立检查 D1 的 `enabled`、provider/issuer、version、digest 和 generation；不能仅依赖应用层已读取的旧配置。近期证明只来自真实本地密码与已启用因子，不能由外部回调、模拟身份、注册或会话刷新推断。因素未启用且策略允许时沿用密码近期门槛；策略要求 MFA 时仍检查本地因素。回调及确认不延长五分钟窗口，任何授权代际变化都使旧快照失效。

每个动作有独立 cookie：HTTPS 下名称为 `__Secure-cloudforge.oidc-link.<SHA256(state)>`，本地 HTTP 去掉 `__Secure-`。cookie 为 HttpOnly、SameSite=Lax，HTTPS 下 Secure，Path 精确限制为该 provider 回调路径，期限不超过原证明。旧 start 的迟到响应不能覆盖新 cookie；旧回调只删除自己的 cookie，被替换动作的残余 cookie 按原期限过期。相同回调的失败竞争者不能清掉已经领取交换的胜者。

成员 API 位于 `/api/me/oidc`，管理员 API 位于 `/api/admin/oidc-provider`；写请求绑定 `X-CloudForge-Session`，响应禁止缓存。GET 回调在 SDK 的 `/api/auth/*` 通配路由之前挂载。回跳只携带动作 ID 和固定状态，页面通过同一会话查询实际候选，不信任 URL 参数作为身份或授权。请求日志脱敏回调 code/state。

## OIDC 协议与出站边界

`worker/src/oidc/provider.ts` 独立执行协议。发现文档 issuer 必须精确匹配配置；authorization、token、JWKS 端点只能使用允许的 HTTPS DNS origin。拒绝 IP 字面量、本地主机、单标签名称和常见私有后缀；当前没有 endpoint path 白名单。Worker 拉取发现文档、token 和 JWKS 时不跟重定向，正常 IdP 浏览器登录导航不属于这项 fetch 策略。

fetch 使用 `redirect: 'manual'`，拒绝 3xx、其他非成功状态、`redirected` 或不匹配的最终 URL。Workers 不支持标准 `redirect: 'error'`，构造请求即抛错；手动模式加状态检查遵循 [Cloudflare Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/#parameters)。每次请求至多五秒、响应体至多 64 KiB；header 提前拒绝、超限、超时和迟到响应均取消未读 body。secret 仅按表单编码后用于 Basic 请求头，不写 URL 或请求体。

ID token 必须存在且签名有效，仅允许 RS256 或 ES256。JWKS 至多 32 个公钥，只接受相应 RSA / P-256 签名验证键，拒绝私钥、对称键及远程 key URL。明确要求 `iss`、`sub`、`aud`、`exp`、`iat`、`nonce`，验证固定 issuer、client ID、nonce、整数时间和 token 年龄。`exp` 必须仍在未来且晚于 `iat`；`iat` 不早于动作开始前 30 秒，未来容差至多 30 秒，token 最大年龄十分钟。多 audience 必须带匹配 client ID 的 `azp`，只要出现 `azp` 就必须匹配。这是本项目在 [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) 基础上的明确收紧，使用 [JOSE `jwtVerify`](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) 校验。

缺少 ID token 时拒绝，不用 userinfo 代替。不申请或持久化外部 refresh token，也不持久化收到的 access/ID token；只提取身份键和受长度限制的可读字段。IdP 的 `amr`/`acr` 不等同于本地 MFA，不写入本地 `password` 证据。

metadata 与原始 JWKS 分别缓存已完成的数据，各至多 16 项、TTL 五分钟，以完整配置摘要隔离。每次请求重建本地 JOSE verifier，不跨请求缓存 Promise、Response、stream 或带 I/O 的远程 key resolver，遵循 [Cloudflare 请求间 I/O 隔离](https://developers.cloudflare.com/workers/observability/errors/#cannot-perform-io-on-behalf-of-a-different-request)。并发冷请求独立拉取。未知 kid 或签名失败时，仅缓存已存在至少 30 秒才刷新 JWKS 一次；最近缓存失败直接拒绝，密钥轮换可能有短暂拒绝窗口。

URL 过滤和 origin 限制不等于 DNS 级 SSRF 防护。当前没有解析并固定连接 IP，未覆盖受信 DNS 解析到私网或 DNS 重绑定的全部情况；部署者须审查 issuer 和额外 origin 的控制权。真实 IdP 网络、证书和轮换行为须在明确配置后另行验证。

## 界面与恢复边界

预览、候选和确认摘要仅在当前组件内存，不进入持久存储或共享 query cache。账户/会话变化、pagehide、卸载清除确认状态并取消请求；浏览器缓存恢复后重新查询。离开页面前往 IdP 不能自动取消服务端动作。异步结果检查原会话及操作代数，旧响应不能复活候选或确认勾选。

候选和管理员发布均须独立确认。过期候选移除执行控件，配置不再 ready 时阻止确认、保留取消。提供商和 claim 均按普通文字显示，不生成 HTML、图片或外链。仅明确尚未执行的近期验证挑战可提示重验并重试一次；策略拒绝不自动重放。

绑定不删除密码或本地因素，不改变实例 MFA 策略。本地 `reset-password` / `reset-mfa` 保持现有语义，恢复后的代际使既有会话和已识别的旧登录动作失效，不自动撤销独立 IdP 主因子；需要时明确撤销绑定或停用 provider。SSO 不能绕过强制因素或最后管理员恢复。

SSO 会话的私有 `oidcBindingId`、`oidcBindingRevision`、`oidcConfigurationGeneration` 独立于当前认证方法。真实密码重验和同账户密码/因素操作替换会话时保留来源，独立本地密码登录才建立无外部来源的新会话。撤销绑定、发布新配置或停用会原子删除相关 SSO 来源会话并取消已识别候选；每次 REST/原生认证仍检查当前来源，部分字段或 OIDC 方法缺来源均拒绝。敏感操作写点继续检查活会话，已撤权来源不能靠重验改为 password 后留下权限。已经独立签发的 PAT、部署令牌和 OAuth 凭据仍服从各自原有规则，不冒称随浏览器会话全部撤销。

## 验证矩阵与未覆盖边界

| 范围           | 当前证据或验证入口                                                                                          | 边界                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 登录状态机     | `oidc-sign-in.test.ts` 26 项通过，含本地因素、签发回滚、来源撤权、库存恢复和真实 native sign-out            | 真实 workerd / D1；外部 IdP HTTP 为受控 fixture                      |
| 绑定与来源     | `oidc-linking.test.ts`、`oidc-session-source.test.ts`；来源转换先行 15 项及旧认证组合 162 项通过            | 新增 fail-closed 项及完整当前源码仍以整合日志为准；组间重叠不加总    |
| 协议           | `oidc-provider.test.ts` 70 项：旧摘要/密文兼容、purpose 隔离、严格 claims、恶意端点/key、重定向和资源限制   | 真实 WebCrypto；外部 HTTP 为受控 fixture，不是企业 IdP 联调          |
| 密钥轮换       | `session-secret-cache.test.ts`：旧 secret 预热后，新 secret 的 REST 与 SDK 一致拒绝，连续访问不能延长旧签名 | 当前定向 1 项通过；没有证据表明线上曾被利用                          |
| 请求隔离       | 上一绑定阶段独立 Miniflare 9 次真实 HTTP 验证完成数据缓存及重定向拒绝                                       | 本轮没有把它冒称为重新运行的 SSO 端到端测试；测试日期/网络不等同生产 |
| 界面           | 实际 HTTPS 浏览器 19 项、前端纯逻辑 37 项通过，含 Host-cookie、Web Locks、确认和未知结果不重发              | 浏览器 API/IdP 为 fixture；子集复验不重复计数，不等同真实 IdP 全链路 |
| 完整验收与上线 | 最终整合日志核验 `yarn test`、`yarn typecheck`、生成器、格式和构建                                          | 定向结果和生成器中途输出不等于全套通过；生产迁移/部署另行授权        |

源码入口为 `worker/src/oidc/`、绑定路由 `worker/src/routers/oidc-router.ts`、声明触发器 `worker/src/db/oidc-sign-in-triggers.ts`、账户/管理组件及登录完成页 `src/pages/OIDCSignIn.tsx`；责任路由见 [代码地图](../repo-docs/code-map.md#oidc-绑定与-sso-的修改路由)。定向通过不能替代完整检查，也不表示已推送或线上已启用。
