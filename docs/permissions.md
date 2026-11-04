<!-- CloudForge fork permissions guide. SPDX-License-Identifier: GPL-3.0-or-later. -->

# 团队与权限：当前实现与改造入口

本文说明当前代码怎样判定访问，帮助维护者区分已有能力与后续设计。多团队和五级仓库角色的能力矩阵、兼容迁移与验收要求见[权限设计草案](team-access-design.md)；该草案尚未成为运行时能力。认证与近期证明的当前约束以[认证专题](authentication.md)为准。

## 当前身份和团队

实例成员的站点角色仍为 `admin` 或普通成员，封禁状态另行检查。Reviewer Agent 是独立的无凭据身份，不能通过密码、浏览器、PAT 或 MCP 会话登录，也不作为普通协作者。界面是否显示按钮不能代替服务端鉴权。

共享团队目前是命名空间，不是授权组。`teams` 没有成员关系表，`GET/PUT /api/team` 选择共享团队。团队仓库记录不可变 `teamId`；`ownerId` 在个人仓库表示所有者，在团队仓库表示创建者。团队创建者的管理员能力不能在迁移时误当团队所有权或静默删除。

团队仓库默认 internal，仓库管理员可以明确公开为 public，禁止 private。2026-10-31 用户明确选择保留这项现有能力，AGENTS 已据此更正；角色迁移不暗改历史可读集合。此项为规范一致性修正，不把原本明确支持并有测试的公开能力计作漏洞。

## 当前仓库访问

| 当前身份                   | 读取范围                    | 推送和协作写入 | 仓库管理 |
| -------------------------- | --------------------------- | -------------- | -------- |
| 站点管理员                 | 所有仓库                    | 允许           | 允许     |
| 个人所有者或团队仓库创建者 | 对应仓库                    | 允许           | 允许     |
| 直接协作者                 | 对应仓库                    | 允许           | 拒绝     |
| 其他有效实例成员           | 团队、internal、public 仓库 | 拒绝           | 拒绝     |
| 匿名或封禁成员             | 仅 public 仓库              | 拒绝           | 拒绝     |

[仓库权限入口](../worker/src/repositories/service.ts)的 `permissionsFor`、`permissionsForMany` 与 `visibleTo` 必须给出一致可读集合；单项、批量与通知候选复用[权限兼容内核](../worker/src/repositories/permissions.ts)的 `permissionsOf` 规则。单项入口不可见时返回404；批量列表、搜索、通知和命名空间页面不能另算一套可见性。协作者以仓库/成员联合键标识；兼容迁移新增 role 和 revision，当前数据库仍只允许 write，不能虚构旧记录原先具有 read/admin 等级。

Git HTTP 与 LFS 对成员 PAT 使用实时成员权限和令牌 scope 的交集；read scope 不因签发者是管理员而变成写。仓库部署令牌有独立身份，只能用于其不可变仓库 id 的 Git/LFS，签发者仍须是有效管理员，不能继承 REST/MCP 或受保护引用权限。具体限制见[部署令牌](deploy-tokens.md)。

默认及受保护分支继续只接受管理员快进，禁止删除/强推；内部 pull refs 禁外写。仓库写权限不跳过合并门禁、作者自批限制、Agent 邀请、guarded 人类逐项决策或代决规则。MCP Moderator 每次检查当前 consent 与真实审批权限，只能处理仍被允许委派的未决事项，见[自动合并](auto-merge.md)。

## 阶段 A：命名能力兼容层

当前已增加内部 `can(perms, capability)`。调用方声明要做什么，再由兼容内核映射到原 read/write/admin；返回给现有客户端的三个布尔值不增加字段。此阶段不接受新的角色输入，不新增团队成员表或权限迁移。

| 当前门槛 | 内部操作能力                                                                                                                                                                 | 既有额外约束                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| read     | read                                                                                                                                                                         | 私有仓库不可见统一404；列表与通知使用同一可读集合。                             |
| write    | push、manageIssues、editPullMetadata、managePulls、runActions、publishStatus、publishRelease                                                                                 | 作者例外、PR状态/审查、MCP Moderator与提交状态入口限制仍分别检查。              |
| admin    | editSettings、manageProtection、manageAccess、manageAgents、manageWebhooks、manageActionsSecrets、manageActionsVariables、manageDeployTokens、deleteRepository、deleteIssues | 不等于站点管理员；近期证明、默认/保护分支规则、专用部署令牌写点不由能力名替代。 |

例如普通协作者仍能维护 Issue、推送普通分支及运行 Actions，却不能因为出现 `editSettings` 能力名而修改仓库设置。read scope 通过共用 `withTokenScope` 去除 write/admin，再求所有命名能力，因此管理员签发的只读成员令牌也不能借新名称写入。部署令牌继续走独立的签发者/仓库/引用检查，不经这一成员 scope helper 变成可登录身份。

本阶段保留 SQL `visibleTo` 的既有公式，用真实 D1 差分校验它与单项/批量的可读集合；没有为统一命名引入逐对象权限查询、跨请求角色缓存或自动刷新旧令牌权限。公共读取、internal 实例成员读取及团队创建者权限保持不变。新的 triage/maintain 只有后续模型、接口及发布围栏就绪后才可授予，不能仅修改这里的映射表提前启用。

## 阶段 B：受限的兼容存储

当前已声明并生成兼容迁移：旧协作者补默认write和revision，共享团队补instance模式和revision，新增永久授权状态与归一化命名空间claims。数据库仍只接受write协作者和一个instance共享团队；五级role/explicit类型为后续扩展预留，不表示已经能授予。team_members及repository_team_grants尚未创建，公开DTO仍保持原字段。

共享团队按状态行中的稳定id读取；状态缺失、指针悬空或不一致会失败，不回退到第一行。团队存活时不能改绑id；无仓库引用时合法删除会清空指针并推进代数，再创建属于新的共享团队。当前没有团队删除API。团队修改按读取的revision和共享指针CAS，竞争返回409；revision由触发器推进，旧Worker的name/slug写法继续可用。

用户名与团队slug由同条SQL内的源守卫和claims维护共同防撞名，覆盖原生管理员创建、用户改名、Agent及旧路由。null用户名不占claim，大小写同义改名不释放给他人，Agent软删除保留命名空间。直接REPLACE/关闭CHECK不能绕过关键状态和命名空间guard。重复协作者写入保持已有row/revision，空RETURNING只代表未新增授权，不作为授权成功屏障。

授权状态行不能删除、替换或重置；相关权限源变化同语句推进独立generation，上限为JS安全整数。代数目前是兼容基础，尚未为所有人类mutation接入最终actor/session/proof/generation CAS。write-only/instance-only限制保护旧权限语义，完整的新角色发布、旧Worker最低版本屏障和回滚流程仍待实现。旧代码首次setup对D1变化计数的假设不适用新触发器；首次管理员初始化应使用包含RETURNING修补的新版本，不能据本节推断任意旧版本可回滚。

## 当前授权管理写入

共享团队 PUT 与协作者 PUT/DELETE 已接入[最终写入检查](../worker/src/access/write.ts)。例如管理员发起团队改名后、SQL 执行前被撤销管理员身份，该请求返回409，团队、命名空间及成功审计均不改变。正常改名保留稳定团队id和原DTO。

这些入口要求浏览器近期本地密码及已启用的第二因子证明。写入同时核验当前管理员或仓库所有者、封禁状态、活会话、认证/策略代际、OIDC来源、原证明时间、密码账户和因子身份，以及最初读取的ACL generation；新证明不会替换在途请求的旧快照。过期判定使用执行SQL时的数据库时间。团队另查revision与稳定指针，协作者另查URL仍指向同一仓库和目标账户，删除还查原协作者revision。

重复添加和删除不存在的协作者，只有同一条权威查询确认当前授权与目标状态时才返回成功；实际条件写入零行返回409，不会假报成功或自动重放。成功新增/移除保留原审计，团队成功创建/改名记入实例设置审计；无变化不重复记事件。异常旧Agent协作者仍可由管理员删除，但不能通过PUT新增。审计写入失败沿用不抛业务错误的契约，不声称与业务写入原子提交。

上述三个入口覆盖共享团队和协作者管理。站点设置的保存与恢复默认也已复用原浏览器会话、近期证明及权限代际，在最终 D1 写入处复核；例如等待期间管理权限变化，原请求返回409，不保存设置或记录成功审计。没有覆盖值的重复重置仍需同一授权有效才返回成功，具体交互见[配置说明](configuration.md)。原生管理员接口的独立适配见[认证](authentication.md#最近身份验证)。普通业务mutation的全面写点改造、角色发布与旧版本回滚屏障仍待实施；当前没有新的团队成员或五级角色写API。

迁移只由声明生成。一次性回填以id/hash登记在_data.json，后续DDL/trigger重建不重复初始化状态；多条旧团队、命名空间碰撞、团队private或孤儿引用会阻断，不能静默修数据。详见[升级边界](updating.md#access-compatibility-schema)。

## 迁移前的只读预检

准备改造团队和角色前，先选择一个明确实例检查旧数据。在源码 checkout 中运行：

```sh
yarn cloudforge access-preflight --name cloudforge
# 手工部署、没有本地安装记录时，账号和数据库都必须明确：
yarn cloudforge access-preflight --database <数据库名或UUID> --account <账号ID或名称>
```

命令核对实际账号、数据库及已有安装归属，先读取有界结构元数据，再选择对应的单条 SQL 快照；最终快照再次校验结构和归属，避免把探测之后的结构变化当作旧模型读取。它不会写本地安装状态或应用数据，不需要 Docker，不接受 `--yes`、`--expect-plan` 或 apply 参数。示意输出中的状态字段如下，其余字段包含目标、摘要、计数和异常对象标识：

```json
{
  "command": "access-preflight",
  "reportVersion": 2,
  "schemaVersion": "compat-v1",
  "blocked": false,
  "rolePublishingAllowed": false,
  "migrationApplied": false
}
```

退出码0只表示这次观察未命中阻断项；1表示发现阻断项或未能取得有效快照，2表示命令参数不合法。`schemaVersion` 明确区分 `legacy`、`compat-v1` 和 `runtime-bridge-v1`，兼容库另报当前 `accessGeneration`；桥接库还报告不含秘密的 `runtime` 观察，未知或部分结构拒绝。摘要标识本次观察，不能作为以后写入的授权、最新状态证明或全实例已切换的标志。无论退出码为何，角色发布和迁移状态始终为false，`rollbackSafe` 也始终为false；本命令不修改运行时底线，也不证明旧 Worker 已全部退出。

预检报告共享团队id、协作者按write保留的数量、团队创建者管理员来源、公开仓库集合及异常引用。兼容库同时检查永久状态行、稳定团队指针、instance模式、write角色、revision、命名空间claims，以及受支持的表定义和受管触发器。桥接库另外要求 `access_runtime_state` 的完整定义、永久单行、最低协议、模式、关闭的角色发布和四个运行时触发器均可识别；最低协议高于当前源码的 1 时阻断。触发器同名但内容变化也会拒绝。例如正常兼容库可以输出上述成功诊断；若共享指针悬空或协作者被改为read，命令会阻断，绝不把read重新解释成write。

多条旧团队、用户名/slug归一化冲突、团队private历史行或未来的显式团队/角色模型仍需要单独处理，不能任选第一行或静默改可见性。封禁成员保留的休眠授权不自动删除；Reviewer Agent正常拥有自己的配置仓库，不能一律当坏数据，也不能计作可登录的人类恢复管理员。

每类集合最多1000条，额外一条用于探测溢出；字段、schema元数据和响应大小也有界，兼容数据合并前还检查总字节预算。超过边界会阻断，不能把截断列表当作完整预检。每类异常样例最多20条，数量与样例分别报告。读取不包含账户邮箱、密码、会话、因素秘密或机器令牌；安装归属秘密只参与绑定比较，不出现在输出中。表约束和权限受管触发器有完整校验，权限表上的未知触发器也会拒绝；这不等于核验所有认证触发器正文或其他表上的定制代码，不能用于证明未来角色迁移、真实负载或恢复凭据可用性已验收。

实现与操作说明见[升级维护](updating.md#legacy-access-preflight)，完整后续模型见[权限设计](team-access-design.md)。

## 账户资料和管理边界

成员列表与用户命名空间资料使用同一个账户邮箱规则：只有站点管理员和成员本人能看到该账户邮箱；其他成员收到 null，团队和 Agent 不公开账户邮箱。命名空间 API 仍要求成员登录。Git 提交对象原本携带的作者/提交者邮箱属于提交数据，不由这个账户字段规则隐藏或改写。实现和回归见[公共成员投影](../worker/src/members/users.ts)、[邮箱与提交归属测试](../worker/src/__tests__/auth/commit-emails.test.ts)。

站点管理员写接口还受近期本地密码、已启用因素、受限会话及 OIDC 来源约束，仓库 admin 不等于站点 admin。[认证专题](authentication.md)说明原生接口、MFA 策略和离线恢复；不能从 SDK 插件已注册推断所有管理员操作都可直接执行。

删除用户与删除仓库的生命周期不同：`repositories.owner_id` 的级联语义同时涉及个人仓库和该成员创建的团队仓库。本轮删除防护要求先通过正常仓库删除流程处理这些仓库；原生成员删除保留 SDK 管理权限和近期认证门槛，以单条 D1 用户删除原子清理会话/账户，最终 SQL 与声明触发器拒绝仍有仓库的删除，避免先删除凭据再拒绝用户删除。没有新增仓库转移功能，不能用删创建者模拟移交，也不能把数据库级联当作外部存储清理完成的证据。

## 后续实施顺序

阶段 A 已实现内部兼容求值和现有入口的命名能力接入，保持旧权限结果。后续按[设计草案](team-access-design.md)已加入只读预检和声明生成的受限兼容数据；后续先补版本化发布/恢复门槛和最终授权CAS，再实现显式团队成员/授权接口及界面。新增 triage/maintain 不得简单复用 `.write` 或 `.admin` 绕过敏感边界；旧 Worker 不能在回滚后把新 read/triage 协作者当 write。

当前测试入口为 `repo-permissions.test.ts`、`teams-visibility.test.ts`、`public-repos.test.ts`、`repos-pulls.test.ts` 和 `commit-emails.test.ts`；列出文件不表示本页完成全项目或生产验收。需要定位权限职责时从[源码代码地图](../repo-docs/code-map.md)继续，实际运行命令与完成标准见[开发说明](development.md)。
