<!-- CloudForge fork design (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later. -->

# 多团队与五级仓库权限设计

状态：**设计稿，尚未实现**。2026-10-31 根据 `4f3c39099810b81cf24dd1d13f144f9dce3c7a0f` 的源码核对现状；本轮不创建团队成员表、不执行迁移，也不把下述接口当作已发布能力。本文承接[路线图](roadmap.md)第 5 项，保留[认证](authentication.md)、[部署令牌](deploy-tokens.md)及[自动合并](auto-merge.md)的独立约束。

## 先看一次授权变化

假设 Alice 是个人私有仓库 `alice/api` 的所有者，Bob 是旧协作者。迁移后 Alice 仍为 `admin`，Bob 的旧协作者记录转为直接 `write` 授权。管理员新建显式团队 `platform`，把 Carol 加入团队，再为该团队授予 `alice/api` 的 `triage`。

| 请求或变化                                 | 设计中的结果                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Carol 查看该私有仓库、给 Issue 加标签      | 允许；团队授权提供 `triage`，包含读取。                                                                                |
| Carol 推送代码、重跑 Actions、修改仓库成员 | 拒绝；`triage` 不提供这些能力。                                                                                        |
| Bob 同时加入 `platform`                    | 仍是 `write`；多个来源取最高角色，不因新增低角色而降权。                                                               |
| 仅删除 Bob 的直接授权                      | 降为 `triage`，并非不可见；影响预览应显示剩余团队来源。                                                                |
| Carol 被移出 `platform`，没有其他授权      | 后续 Worker 请求不能读取该私有仓库，也不能申请新的 LFS URL。已签发的 URL、已下载字节及已进入外部执行的请求不因此收回。 |
| 仓库是 `internal` 而非 `private`           | Carol 作为实例成员仍能读取；离开团队只撤销团队贡献的操作能力。                                                         |

这个例子区分三个概念：团队成员资格、仓库可见性、仓库操作角色。三者不能用一个 `teamId != null` 或 `write` 布尔值代替。

## 已确认的起点

| 当前事实                                                                                            | 源码依据                                                                                                                                                                | 对新设计的约束                                                             |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 只有一个共享团队入口，`getTeam` 查询第一行；`teams` 只有 id/slug/name/createdAt                     | [团队声明](../worker/src/db/app.schema.ts)、[团队路由](../worker/src/routers/teams-router.ts)、[仓库访问](../worker/src/lib/repos.ts)                                   | 新 API 必须按不可变团队 id 选择；旧入口不能在多团队后继续任取第一行。      |
| 团队 slug 与用户名共享大小写归一化后的 URL 命名空间                                                 | [命名空间检查](../worker/src/lib/namespaces.ts)                                                                                                                         | 创建、改名及用户改名必须在数据库写点防撞名；仅预读检查不足以证明并发安全。 |
| 团队仓库的 `ownerId` 是创建者，个人仓库的同字段才是所有者                                           | [仓库声明](../worker/src/db/app.schema.ts)                                                                                                                              | 不能从 `ownerId` 推导团队所有者；升级不能默默移除旧创建者的管理员权限。    |
| `repository_collaborators` 没有 role 列；存在协作者记录就获得写权限                                 | [协作者声明](../worker/src/db/app.schema.ts)、[统一判定](../worker/src/lib/repos.ts)                                                                                    | 旧协作者只能回填为 `write`，不能虚构旧 read/admin 角色。                   |
| 实例管理员及 owner/creator 为仓库管理员；普通成员可读团队、internal、public 仓库，匿名仅可读 public | 同上 `permissionsOf / readableByMembers / visibleTo`                                                                                                                    | 保留公共读取与实例级 internal 读取；团队成员资格不用于收窄它们。           |
| 仓库路由、Git、MCP 使用读取/写入/管理员三个布尔值，部分后台另有同义 SQL                             | [仓库上下文](../worker/src/lib/repos.ts)、[Git 入口](../worker/src/git-http.ts)、[MCP 工具](../worker/src/mcp/tools.ts)、[通知候选](../worker/src/lib/notifications.ts) | 引入角色时必须同步每条路径，尤其不能只改页面按钮。                         |

团队仓库默认 `internal`，仓库管理员可以显式设为 `public`，不得成为 `private`；这是用户在2026-10-31明确保留的兼容契约。新模型不改变现有团队仓库的公开集合，也不引入“团队私有”的新语义。当前创建器将团队输入的默认private归一化为internal，并保留显式public；旧创建入口继续兼容该规则，新的显式teamId接口应对private请求明确拒绝。既有public团队仓库在迁移后仍可匿名读取，改为internal或重新开放public必须是独立、明确的管理员操作，不能夹带在角色回填里。若遗留行出现teamId非空但visibility=private，基线实际仍对实例成员可读，不能据字段值承诺其曾经私有；预检应报告异常并停止自动归类。

## 组织、团队与命名空间

一个部署仍然对应一个实例组织。首版不加多租户、跨实例身份、子组织、嵌套团队、外部访客或显式 deny 规则。实例账号、站点管理员和内部仓库的范围保持不变。

团队既可拥有仓库命名空间，也可作为仓库授权的成员集合。仓库只有一个归属命名空间，ACL 可以引用多个团队；给另一个团队授权不会移动仓库。改 slug 只更新寻址元数据，Git/Artifacts、LFS、PR、Actions、部署令牌仍绑定仓库不可变 id；不能改 `artifactsName` 或按新 slug 重建存储。

首版由站点管理员创建团队、管理团队成员和团队 ACL，使用近期本地联合认证。普通团队成员不是团队管理员，也不自动获得该团队命名空间下所有仓库的写权限。显式团队成员可以在本团队命名空间创建新仓库；创建者只成为新仓库的管理员。个人仓库创建沿用原规则。把团队管理委派给非站点管理员属于后续设计，不能让一个只管理成员名单的人借“加自己入组”获得其原先无权管理的仓库。

保留旧共享团队的稳定 id，记为 `legacySharedTeamId`；旧 `/api/team` 只指向该兼容入口。建议将旧共享团队标记为 `membershipMode: instance`，保持所有有效实例成员可在该命名空间创建仓库的旧行为；这是兼容命名空间，不作为新的团队 ACL 主体。新团队均为 `explicit`，只按实际成员行授予角色。旧共享团队不会被批量转换成全实例 `write` 组，也不会因普通成员未来加入实例而自动扩展新团队的授权。

若旧库没有团队，兼容 id 为 null，绝不把第一个新显式团队当成旧共享团队。若预检发现多条旧团队记录，则停止自动选择兼容团队，由管理员按真实团队/仓库 id 处理，不能靠 `limit(1)` 决定迁移对象。首版团队删除只允许无归属仓库、无授权引用的显式团队；有资源时返回冲突并列出需先处理的引用，不级联删除仓库、不隐式转移，也不在本阶段增加仓库转移能力。

## 五级角色与能力

角色按 `read < triage < write < maintain < admin` 排序，授予高角色包含较低角色。没有授权为 `none`；匿名 public 读取是独立的公共能力，不代表具有成员 `read` 身份。

下表是**建议的首版能力矩阵**。每个入口仍须满足身份类型、当前可见性、作者身份、原有状态机及认证门槛，角色不是跳过这些条件的通行证。

| 能力                                                               |  read  | triage | write  | maintain |     admin      |
| ------------------------------------------------------------------ | :----: | :----: | :----: | :------: | :------------: |
| 读代码、clone/LFS 下载、可见 PR/Issue、现有可见 Actions 日志与产物 |   ✓    |   ✓    |   ✓    |    ✓     |       ✓        |
| 登录成员新建 Issue/PR、评论、编辑自己的内容                        | 原规则 | 原规则 | 原规则 |  原规则  |     原规则     |
| 维护 Issue 标题/正文/状态、标签与指派；管理仓库标签                |   —    |   ✓    |   ✓    |    ✓     |       ✓        |
| 修改他人 PR 的标题/正文等纯元数据                                  |   —    |   ✓    |   ✓    |    ✓     |       ✓        |
| 推送普通分支、LFS 上传、创建分支/标签、清理可清理分支              |   —    |   —    |   ✓    |    ✓     |       ✓        |
| PR 变基、retarget、关闭/重开他人 PR、落地、回退、队列操作          |   —    |   —    |   ✓    |    ✓     |       ✓        |
| Actions 重跑/取消、删除运行产物、提交状态、创建 Release            |   —    |   —    |   ✓    |    ✓     |       ✓        |
| 修改描述、Issues 开关、合并后删分支偏好                            |   —    |   —    |   —    |    ✓     |       ✓        |
| 默认/保护规则管理、既有受保护分支管理员快进推送                    |   —    |   —    |   —    |    —     |       ✓        |
| 查看/修改成员与团队授权、代理邀请、Webhook/Actions 变量与密钥管理  |   —    |   —    |   —    |    —     |       ✓        |
| 部署令牌管理、改名/可见性、删除仓库、删除他人 Issue                |   —    |   —    |   —    |    —     |       ✓        |
| 实例策略、实例密钥白名单、团队管理、站点账号管理                   |   —    |   —    |   —    |    —     | 仍须站点管理员 |

`triage` 首版不新增关闭他人 PR 的能力：关闭可能关联 head 保留/清理和关闭 outbox，不能把它当成无 Git 副作用的元数据动作。保留原先作者对自己内容的操作例外，须同时拥有当前读取权；不能用历史作者 id 绕过已撤销的私有仓库访问。指派仍拒绝 reviewer agent，不因能分配角色而把 agent 当作可登录成员。

`maintain` 只新增表中列出的低风险设置能力。设置 PATCH 必须逐字段鉴权；混合提交 description 与 protectedBranches 时整次拒绝，不能先写允许字段再丢弃禁止字段。不得把 `maintain` 映射为旧 `.admin=true`，否则会连带获得密钥、授权和部署令牌等能力。仓库 admin 不等于站点 admin，也不替代已有近期密码/本地因素证明。

不能管理密钥 API，不代表能隔离恶意代码。`write`/`maintain` 继承工作流写入及重跑能力，可能让工作流使用该仓库获准的密钥；日志脱敏不阻止网络外传。保留现有实例密钥仓库白名单、PR 上下文与 runner 约束。更强的可信 ref/工作流隔离属于后续分支保护设计；本角色改造不许诺读不到所有运行秘密。

分支保护继续独立执行：默认/受保护分支的管理员快进、禁止删除/强推和内部 `refs/pull/*` 禁外写不变。空仓默认分支的既有初始化例外由原 Git 规则判断，不能因为新增 maintain/triage 而扩大。部署令牌仍必须由管理员初始化默认分支，且无默认/受保护/内部 ref 写权限。落地仍走 pause → stack → checks → review，作者自批、guarded needs_person、Moderator 和代决限制均不改变；不得由 Agent 代人批准。

## 有效角色与兼容输出

有效成员角色取以下来源的最高值：站点管理员、个人仓库所有者或保留的团队仓库创建者、直接成员授权、显式团队成员获得的仓库团队授权、可见性提供的 `read` 基线。封禁或无有效成员身份先剔除成员来源；原有匿名 public 读取行为单独处理。Reviewer agent 及系统工作流不进入普通人类角色叠加。

个人 owner 与现有团队 creator 的管理员来源首版继续有效，不能仅删除一条 ACL 就承诺其失权。团队仓库 `ownerId` 同时受既有用户 FK 影响，不能在这个阶段改含义或删用户来模拟权属转移。若以后要移交创建者管理权，应独立设计显式保留/撤销、数据所有权与最后管理员恢复；本迁移不做。

普通ACL行的createdById记录授权操作来源，不是持续委派链；不因当年授权人后来离任而递归取消全部有效授权。撤销以当前授权行及代数为准，管理员离任时可按审计做明确回收。部署令牌另有每次检查签发者仍为admin的既有约束，不与普通ACL混同。

团队 ACL 首版最高 `maintain`，`admin` 只给直接成员或既有 owner/creator/站点管理员。这样移出团队只影响普通操作权限，不会同时改变最后一个仓库管理员是否存在。删除最后一个可用直接管理员时，仍应验证 owner/creator 与有效站点管理员能恢复；不允许把已封禁成员、agent 或没有本地恢复路径的虚拟身份计入可恢复管理员。站点最后管理员的原有认证与离线恢复规则独立保留。

建议统一入口返回 `effectiveRole` 与结构化 capabilities；保留旧 `read/write/admin` DTO 一轮兼容：`write` 仅在角色至少 write 时为 true，`admin` 仅对 admin 为 true。新 triage/maintain 使用命名能力，不从前端传来的 role 决定。`permissionsFor`、`permissionsForMany` 与 `visibleTo` 必须共享同一权限规则，通知、检索、namespace、列表统计和实时提示必须使用相同可读集合。批量查询按集合联表/JSON 参数完成，不逐仓库、逐候选查询，不能生成超过100绑定参数的 IN 列表。

界面解释权限时只向有权管理该仓库的人显示具体团队/成员来源。普通读者仅看自己的有效能力，不能通过“为什么有权限”接口枚举其他私有团队和成员。

## 声明草案与写点权限

以下名称是待实现草案，不是本轮生成的 schema，也不指定迁移编号：

| 声明                            | 最小字段和约束                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `teams` 扩展                    | membershipMode: instance/explicit、revision；legacy id 在单一实例访问配置中明确记录，instance 模式只允许兼容共享团队。          |
| `team_members`                  | teamId/userId 复合主键、createdAt、createdById；按 userId/teamId 索引；仅显式团队，普通人类成员，不存客户端提供的有效角色。     |
| `repository_collaborators` 扩展 | role 五值、revision；旧行回填 write；保留原复合主键及用户反查索引。                                                             |
| `repository_team_grants`        | repositoryId/teamId 复合主键、role(read至maintain)、revision、createdAt、createdById；仅显式团队；按 teamId/repositoryId 反查。 |
| `access_control_state`          | 固定 id=1、generation、legacySharedTeamId；必须存在且代数单调，禁止删掉再用0代替，缺失时管理和受限写入失败关闭。                |
| `namespace_claims`              | 归一化 slug 唯一主键、kind(user/team)、不可变 subjectId 唯一；用户/团队创建及改名同事务维护，迁移先检查跨表冲突。               |

首版用一个**独立 ACL generation** 协调写点，避免把角色变化塞进认证策略版本或只记入 JWT。成员、直接/团队授权、用户名/团队命名空间、仓库归属/可见性及用户封禁/站点角色改变，均需在声明管理的数据库触发器中推进相关授权代数；必须覆盖 SDK 管理接口、应用路由和恢复脚本，不能只在一个新 REST handler 手动加一。ACL 低频变更先接受全局保守失效，后续有负载证据再拆成仓库/团队代数。

每次成员请求从 D1 权威读取当前权限，不跨请求缓存可变角色。写请求先取得 actor、会话/凭据、ACL generation 与目标 revision，在最终 SQL 内同时重查：身份未封禁、原认证证明仍有效、当前所需能力、代数及目标 revision 未变。角色/成员/团队授权管理额外要求近期本地联合证明；它不能由 PAT、部署令牌、MCP consent 或 OIDC iat 替代。两次并发“互删最后管理员”的请求必须有一个因写点条件不成立而失败。

单行插入用条件 INSERT，更新/删除用条件 DML + RETURNING；零行结果明确映射冲突或拒绝。多条依赖写入要由声明触发器/动作收据保证全部授权后才落地，不能只检查 batch 的第一句。D1 `batch` 中 SQL 语句失败会回滚该批，但普通零行 UPDATE 本身不构成失败，不能把它当事务授权屏障。[Cloudflare D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

迁移只从 Drizzle 声明和声明触发器生成，审阅生成 SQL 及 `_triggers.json`；不手工追加迁移。API 改动审计记录 actor、仓库/团队/主体 id、角色前后值、revision 与来源种类，不记录凭据、成员邮箱、模型文本或完整权限快照。沿用审计失败不抛业务错误的契约；UI 不因审计附加工作失败重发已经完成的授权变更。

## 撤权的准确边界

“立即”指提交撤权后新进入 Worker 的鉴权与签发，以及后续尚未获准的 D1 写入都使用当前权威。不能把页面缓存、旧 JWT 的角色字段或已入队任务中存的 actor 对象当作持续授权。

| 路径                                      | 所需处理与剩余边界                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST、Git/LFS 新请求                      | 当前成员有效角色与凭据上限共同判断；私有仓库无读取权统一404，不泄漏是否存在。                                                                                                                                       |
| MCP                                       | JWT本地验证/当前consent检查继续执行；每次工具调用重新求成员角色，Moderator仍逐次检查且复用实际审查规则。新增团队权限管理首版不开放MCP写工具。                                                                       |
| 待发通知、搜索、Inbox、namespace/团队列表 | 一致过滤可读集合；发送邮件前重查权限、订阅及偏好。已经发出的邮件和已读正文无法追回。成员/团队目录不能附带非管理员可见的账户邮箱。                                                                                   |
| 排队的人类操作或重跑                      | 保存 actor id、仓库 id、操作种类与授权代数；真正执行新特权动作前重查，不在回放时把旧身份重新包装为系统管理员。撤权后停止尚未执行的用户委派动作。                                                                    |
| 事件驱动的 Actions/review/learning        | 继续使用独立的仓库/运行/代理身份、邀请、run/step fencing与状态机；并非“推送者永远保持write”。不能因一次成员退出任意杀死已合法接受的仓库系统任务，也不能让它因此获得新仓库权限。明确区分用户委派任务与仓库系统任务。 |
| Git/Artifacts在途写入                     | D1与Artifacts之间没有在本设计中实现跨服务事务。分发前最后一次D1授权及可审计intent作为接纳点，保存预期ref/CAS；撤权后不接纳新操作，已接纳请求可能稍后完成并写收据。不承诺撤权提交后绝无在途ref落地。                 |
| LFS预签URL                                | 新签发立即受当前权限限制；现有900秒URL可能继续使用至其剩余有效期，既有下载字节不能回收。不能假称删会话/成员即可撤回URL。                                                                                            |
| Actions checkout凭据                      | 当前runner会收到为该仓库新签的只读Artifacts令牌，代码请求TTL300秒；区别于外部Git/LFS成员凭据。停止后续签发/适当停止用户委派作业不能回收已读数据，也不保证已交付短期凭据瞬间失效。                                   |

取消、删除仓库或撤权后的后台清理还必须保持容量契约：先阻止继续执行，确认Workflow和每个容器停止后才释放对应D1预留；停止失败保留容量与重试证据，不因HTTP成功、run被标completed或权限撤销就认为资源已经停下。删除仓库也不能先级联删掉预留记录和恢复证据再尝试停止外部资源。容器销毁成功前保留hard-stop alarm，清理有界、可恢复；本轮发现的HTTP取消/删除旁路修补与最终验收在审计报告单列，不能用设计要求替代其通过证据。

LFS 900秒来自[签名实现](../worker/src/lib/lfs.ts)；Artifacts令牌与checkout行为来自[远端客户端](../worker/src/git/remote.ts)、[执行器](../worker/src/actions/executor.ts)。R2 的预签URL授权持有者在期限内访问指定对象，不能把本地角色改动当作 URL 的在线撤销检查。[Cloudflare R2 Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

成员 PAT 继续受实时成员权限与 read/write scope 的交集约束；read scope 即便来自仓库 admin，也不能写。REST 的 PAT 入口仍仅限既有提交状态 allowlist，不能因为增加角色而接受全部仓库 API。部署令牌仍只用于不可变仓库 id 下的 Git/LFS，actor 为 null，签发者必须每次仍是有效仓库 admin；团队授权最高maintain，不能绕道签发、继承REST/MCP身份或操作受保护ref。仓库 admin 恢复后未撤销的部署令牌可恢复的既有行为保持，永久失效需明确撤销令牌，见[部署令牌生命周期](deploy-tokens.md)。

## 建议 API 与兼容行为

新接口用不可变 id 作管理目标，slug只作显示和已有仓库路径寻址。以下为设计 DTO，不是可调用路由：

| 路径/方法                                     | 输入或输出                                                    | 权限与并发                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/teams`                              | `{items:[{id,slug,name,membershipMode,revision}],nextCursor}` | 已登录成员目录；不混入用户邮箱或私有仓库列表。                                                  |
| `POST /api/teams`                             | `{slug,name}` → 团队记录                                      | 站点管理员+近期本地联合证明；只创建explicit团队，写点占有namespace。                            |
| `PATCH /api/teams/{id}`                       | `{revision,name?,slug?}`                                      | 同上；slug冲突409，全部字段原子生效。                                                           |
| `GET /api/teams/{id}/members`                 | 分页公共成员DTO，不含email                                    | 当前团队成员或站点管理员；不能由公开仓库的团队授权反向枚举成员。                                |
| `PUT/DELETE /api/teams/{id}/members/{userId}` | `{teamRevision,previewId}`                                    | 首版限站点管理员+近期证明；拒agent；返回新revision与操作收据。                                  |
| `POST /api/repos`                             | 新增显式`teamId`，与`owner`互斥规则校验                       | 个人沿用；显式团队需当前成员资格或站点管理员，最终写点复查；legacy `owner:team`仍精确选兼容id。 |
| `GET /api/repos/{owner}/{repo}/access`        | 有效角色与本人能力；admin额外看授权来源                       | 普通读者不拿到全体ACL/私有团队成员。                                                            |
| `PUT/DELETE .../access/users/{userId}`        | `{role?,revision,previewId}`                                  | 仓库admin+近期证明；admin只直授；缺少版本不执行；最后管理员检查。                               |
| `PUT/DELETE .../access/teams/{teamId}`        | `{role?:read..maintain,revision,previewId}`                   | 仓库admin+近期证明；必须explicit团队；不因仓库归属team而隐含该grant。                           |

团队成员变更先调用 `POST /api/teams/{id}/members/preview`，仓库授权先调用 `POST /api/repos/{owner}/{repo}/access/preview`；输入操作种类、主体id、目标revision及适用的role，输出一次性previewId、expiresAt和权限变化摘要。团队成员PUT/DELETE同样必须提交previewId，不能仅靠teamRevision跳过影响核对；仓库管理员的预览不展开其本来无权查看的私有团队成员名单，完整跨仓库影响仅站点管理员可见。

所有body用严格schema拒绝未知字段；role使用精确枚举，revision必须为正安全整数，name去空白后1–100字符，slug按现有1–39字符和保留词规则归一化。id接受有界非空字符串以兼容现有主键，不能把所有历史成员id擅自限定为UUID。cursor最多1024字符且只使用绑定参数，不提供额外授权。

首版每页默认30、最大100，cursor使用查询摘要、排序键、不可变id及ACL generation，拒绝非法/跨查询cursor；权限集合在分页中途改变时返回409要求重取，不能承诺在任意并发写下维持同一快照。成员/授权mutation单对象执行，不加无限批量授权API；后续批量也必须有界并逐对象写点鉴权。影响预览两分钟到期，绑定当前session、目标revision、ACL generation、请求摘要及所显示的有效角色变化；一次消费。成功响应丢失只读收据，不自动重放授予/撤销。HTTP缓存和客户端query缓存以当前会话隔离，敏感ACL与预览响应no-store。

旧 `/api/team` 只读/改名兼容共享团队，不再通过first-row选新团队；没有兼容团队时返回null或明确未配置，不能把旧PUT误用于新团队。旧 collaborators PUT/DELETE暂保留：PUT仅为不存在的直接授权创建write，重复PUT不升低角色、不降高角色；修改角色必须走新API。旧列表继续按原成员可见性返回公开协作者字段，不增加邮箱或内部团队ACL明细，也不能把新只读用户显示成可push；新权限编辑界面使用管理员ACL端点与显式role。新实例只使用新团队接口；旧共享团队转换成显式团队是以后独立、需要影响预览的变更。

## 升级前检查与分期落地

迁移预检先输出无凭据的实际清单：团队行数、归属仓库数、孤立引用、用户名/slug归一化冲突、旧协作者数、owner/creator存活/封禁情况、团队private等与契约不符的历史行及现有public集合。冲突时停止自动发布角色功能，保持原服务版本可读，提供明确对象id供管理员处理，不挑一方覆盖另一方。

| 阶段                  | 可验收成果                                                                                                       | 不做的事                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A：权限内核兼容层     | 新capability求值和SQL可见性，同基线数据逐成员/仓库比较旧布尔结果；所有旧collab为write，owner/creator/admin不变。 | 不开放新团队写接口，不移动仓库，不重新分配数据所有权。                    |
| B：声明与兼容数据     | 生成schema/trigger迁移；唯一共享兼容id；旧collab role回填write；共享命名空间claims；snapshot与resume校验。       | 不给共享团队全实例write，不把普通成员加入所有新团队，不静默改visibility。 |
| C：显式团队和直接角色 | 新CRUD/预览/收据、5角色UI、REST/MCP/Git/LFS及后台能力边界同步；旧端点兼容。                                      | 不授团队admin，不委派团队成员管理，不添加跨租户或外部成员。               |
| D：部署与再审计       | 隔离环境upgrade验证、逐入口竞态矩阵、全套测试/类型/格式/构建、依赖审计、文档与审计结果。                         | 本地验收不等于生产迁移或部署；生产行为分别授权与核验。                    |

发布应保证旧Worker不会忽略新角色把所有协作者当write：新ACL写接口须在所有服务请求都使用新内核后才启用。旧部署回滚前若已有read/triage记录，必须停写并生成显式降级影响报告，不能仅回滚代码让旧 `.collaborator=true` 判定恢复；不支持无损自动降级。迁移完成标记与feature状态必须来自D1权威，不能仅用某个isolate的env开关宣称全局切换完成。

## 实施验收矩阵

所有数据权限用例用workerd真实D1，Artifacts用已有内存fake；不mock env.DB。测试文件进入CI归属清单。下列为**尚待实施的验收要求**，不是本轮测试通过清单。

| 维度           | 必须证明的行为                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基线兼容       | 匿名/封禁/普通成员/旧collab/owner/creator/site-admin × personal private/internal/public、团队internal/public及异常历史行；迁移前后旧read/write/admin和列表集合一致，public团队匿名读取保持。 |
| 五级角色       | 每级覆盖允许与拒绝；triage不可push/merge/rerun；maintain混合设置PATCH整体拒绝，不能管理secret/Webhook/访问/部署token。                                                                       |
| 叠加与撤权     | 两个团队加直授取最高；删其中一个不夸称全部失权；退出/降权/封禁后新REST、MCP、Git、LFS和通知同时服从当前授权。                                                                                |
| 可见性一致     | 单项、批量、visibleTo、search、inbox、namespace、通知候选对同一viewer返回一致可读集合；internal不因退出团队而变private；目录不泄邮箱/隐藏ACL。                                               |
| 写点竞争       | SELECT后角色撤销、预览后成员变化、并发互删管理员、同版本重复提交、batch条件0行、系统任务迟到写；失败不产生授权/操作成功收据。                                                                |
| 机器与代理     | PAT read不继承新能力，部署令牌发行者失admin立即拒新请求；所有REST/MCP身份边界不扩大；reviewer agent不能入人类团队/ACL或拿凭据。                                                              |
| Git与副作用    | 新角色保持默认/保护/内部ref保护、push_events写前响应、merge/close保留期及CAS；在途操作接纳点和结果有真实证据，不承诺跨服务原子撤权。                                                         |
| 命名空间与迁移 | 两管理员首次建团队、用户/团队同名并发、改名冲突、>1旧团队预检拒绝、重复运行不扩权、故障可恢复、旧版本读取新低角色被阻止。                                                                    |
| 容量与性能     | 大于100成员/仓库集合使用JSON/有界批次；列表分页不重复/遗漏；权限检查无逐对象N+1；真实负载再决定是否分片ACL代数。                                                                             |
| 界面与生产边界 | 权限来源/预览不展示不可见成员，撤权后旧页重取且不自动重放；R2 URL剩余有效期、在途请求和已发邮件明确说明；生产配置/IdP/迁移另验。                                                             |

## 改动定位

| 责任                   | 首要源码与测试                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型和兼容迁移         | [应用声明](../worker/src/db/app.schema.ts)、[声明生成器](../scripts/generate-db.mjs)；新增真实D1角色/迁移用例。                                                                                                                                                                 |
| 统一权限、列表及批量   | [仓库权限](../worker/src/lib/repos.ts)、[命名空间](../worker/src/lib/namespaces.ts)、[创建仓库](../worker/src/lib/repo-create.ts)。                                                                                                                                             |
| 团队/仓库设置与成员API | [团队路由](../worker/src/routers/teams-router.ts)、[仓库路由](../worker/src/routers/repos-router.ts)、[公共DTO](../worker/src/routers/schemas.ts)。                                                                                                                             |
| Git/LFS及机器凭据      | [Git入口](../worker/src/git-http.ts)、[LFS入口](../worker/src/lfs-http.ts)、[推送保护](../worker/src/git/push-protection.ts)、[部署令牌](../worker/src/lib/deploy-tokens.ts)、[REST PAT](../worker/src/auth/token-auth.ts)。                                                    |
| MCP、审查和后台        | [MCP工具](../worker/src/mcp/tools.ts)、[MCP会话](../worker/src/mcp/oauth-session.ts)、[Moderator](../worker/src/mcp/moderators.ts)、[代决](../worker/src/review/delegate.ts)、[通知](../worker/src/lib/notifications.ts)、[待发邮件](../worker/src/lib/notification-email.ts)。 |
| 运行动作和设置         | [Actions路由](../worker/src/routers/actions-router.ts)、[执行器](../worker/src/actions/executor.ts)、[密钥](../worker/src/actions/secrets.ts)、[变量API](../worker/src/routers/actions-variables-router.ts)；保护角色不能替代原有容量/重放/秘密边界。                           |

证据状态：起点事实基于上述基线源码确认；角色矩阵、表/接口及分期均为本设计建议，未由本轮文档验证器或既有业务测试证明已经实现。
