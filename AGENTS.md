<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# CloudForge Agent rules

本文件是仓库 Agent 规范的单一来源；CLAUDE.md 只引用本文件。先读命令和所改模块的契约，保护未提交工作。

## 常用命令

只用 Yarn 执行项目命令；不以 npm/npx 替换。运行环境与配置步骤见 [开发说明](docs/development.md)。

| 任务 | 命令 |
| --- | --- |
| 开发 | `yarn dev`（同源应用/API/Git，开发环境会使用远端 Artifacts） |
| 全量测试 | `yarn test` |
| Git 主流程定向验证 | `yarn test:workers worker/src/__tests__/git-http.test.ts worker/src/__tests__/push-protection.test.ts worker/src/__tests__/push-events.test.ts` |
| 类型检查 | `yarn typecheck` |
| 格式检查 / 格式化 | `yarn format:check` / `yarn format`（全仓格式化前确认范围） |
| 数据库 / 认证生成 | `yarn db:generate` / `yarn auth:update` |
| 绑定类型生成 | `yarn cf-typegen`（从 CI 模板生成） |

## 修改前的规则路由

| 改动区域 | 先读 | 必须保留的契约 |
| --- | --- | --- |
| SPA 与样式 | `DESIGN.md`、`src/lib/theme/theme.ts`、`index.html`、`public/_headers`、`src/lib/utils/csp.test.ts` | 登录后路由在 AppShell 内；Primer 与页面样式读取源自 `DESIGN.md` 的同一套功能色、14px 正文锚点与 8px 间距原语。主题启动逻辑与 rootAttributes 同步，变更内联脚本时同步 CSP 哈希。用户 Markdown 清洗不允许样式、表单或应用类名。 |
| 存储与 Git | [架构](docs/architecture.md)、`worker/src/git-http.ts`、`worker/src/git/service.ts` | D1 只存元数据；对象/ref 在 Artifacts。仓库名绑定不可变 repository id。短期仓库令牌不离开 Worker；推送成功引用在回复前写 push_events。 |
| 引用与权限 | `worker/src/lib/repo-permissions.ts`、`worker/src/lib/repos.ts`、`worker/src/git/push-protection.ts` | 操作门槛用 can 的具体能力，成员 scope 用 withTokenScope；当前仅映射原 read/write/admin，不据能力名提前授予新角色。permissionsFor 与 visibleTo 必须一致；团队仓库默认 internal；仓库管理员可明确设为 public，禁止设为 private。默认/保护分支只收管理员 fast-forward，禁止删除/强推；内部 pull refs 禁外部写。内部分支用 resolveBranch 精确 heads 查找，固定 pull refs 用完整 ref；泛用 resolve 仅给用户 ref/SHA。用户名/团队 slug 共享命名空间。 |
| 权限兼容数据 | `worker/src/db/access-triggers.ts`、`worker/src/db/access-backfill.ts`、`scripts/generate-db.mjs` | state行不可删除/重置，generation单调；本阶段只write/instance，claims与源同句维护。一次性回填按id/hash只增不改，旧产物不手写；新角色发布/最终授权CAS仍待实施。测试保留state并走正常subject清理，不关闭生产guard。 |
| 权限运行时准入 | `worker/src/lib/access-runtime.ts`、`worker/src/db/access-runtime-triggers.ts`、[权限设计](docs/team-access-design.md) | 每次从 D1 主库读最低协议，不缓存或藏入可重放 durable step；未知状态拒绝。仅精确 GET/HEAD 安装元数据探针例外且 no-store；Git/LFS 与后台独立入口各自检查，纯停止/销毁保留。新角色保持关闭；入口准入不等于在途写点围栏，也不能约束未包含检查的旧版本。 |
| 部署凭据 | [部署令牌](docs/deploy-tokens.md) | 仅 Git/LFS、绑定不可变仓库、默认只读，1–366 天、每仓原子限制 50 个，只存 SHA256，明文只返回一次且 no-store。每次检查签发者仍未封禁且是管理员；不继承用户或 REST/MCP 身份。先由管理员初始化默认分支，禁止默认/保护/内部引用；actor 为 null 并审计系统动作。 |
| 成员 PAT / 作者归属 | `worker/src/git-http.ts`、`worker/src/lib/commit-authors.ts` | PAT 每成员至多 50 个未过期，使用条件 INSERT 防并发；过期不占额度。作者匹配只认已验证邮箱/备用邮箱并按响应批量查询，禁止逐 commit 查询。 |
| Git LFS | `worker/src/lfs-http.ts`、`worker/src/lib/lfs.ts` | 与 Git 共用鉴权；字节经预签名 URL 在客户端/R2 间传输；D1 仅存裸对象 key，每仓独立且随仓删除。 |
| 合并、关闭与恢复 | [架构](docs/architecture.md)、`worker/src/merge/`、`worker/src/pulls/` | rebase + CAS fast-forward；禁止对默认/保护/共享 head 自动 rebase。保留旧 head 与落地收据，关闭后保留期 30 天。落地先记 intent/receipt 再 CAS，按证据恢复；stale 不冒充成功。关闭 outbox 与状态变动原子提交，state_revision/重开代数隔离迟到写，恢复先于 R2 清理；保持默认/保护/在用 head。 |
| Actions 容量与容器 | `worker/src/actions/queue.ts`、`worker/src/actions/` | 先写 workflow_runs 再启动 Workflow。正常及降级路径都在容器启动前原子预留 D1 容量；恢复按有界游标查预留，确认 Workflow/容器停止才释放；停止失败保留容量。容器销毁成功才移除 hard-stop alarm。 |
| Actions 密钥与重放 | `worker/src/actions/secrets.ts`、`worker/src/actions/state.ts` | 实例密钥只进管理员选定仓库；在 durable step 外解密、日志脱敏。结果按 repo/run/step 加密，大值溢出到运行保留前缀。动态掩码/请求凭据跨重放加密保留；准备/保存失败记失败，不重新执行完成命令。PR 上下文快照用于 rerun。 |
| Actions 兼容性 | [开发说明](docs/development.md)、`worker/src/actions/remote.ts` | 缓存按 ref，先本 ref 后默认分支，写本 ref；字节不经 Worker。每个远端/本地 action 都预留 Post，没 Post 才跳过。runner 镜像和 setup-node 的真实支持范围不得被 README 扩大。 |
| Reviewer Agent | [自动合并](docs/auto-merge.md)、`worker/src/agents/`、`worker/src/review/` | Agent 用户无凭据；拒绝 browser session、PAT 和 MCP session。配置在代理仓库默认分支，更新按索引刷新；guardedOf 与数据库 guarded 一致。审查固定 head/agent SHA；知识至多 20 文件/64 KiB；忽略 lockfile 与 .orangeignore。限流退避、尝试身份和结果写入 fencing 不得弱化。 |
| 审查门禁与委派 | `worker/src/review/gate.ts`、`worker/src/review/flags.ts`、`worker/src/review/delegate.ts` | landing 顺序 pause → stack → checks → review；仓库邀请至少一个 Agent 才自动合并。默认禁止作者自批；修改要求需关闭或新推送，guarded needs_person 逐项给理由，不可 AI 委派。代决仅限仍受邀、存活、未决、unguarded needs_person，保留 via 与审计；坏回答不作决策。undo 只由决策者。不得替人批准 PR 或审查意见。 |
| 学习与 Agent 运行 | `worker/src/learn/`、`worker/src/agent-runs/` | 每 agent/PR 唯一 lesson，单 agent 单 learning，按 run_id 围栏。写权限只给 AGENT.md 正文和 knowledge/**；校验后 CAS 提交最多重试一次。步骤身份可重放，使用量绑定步骤；记录不存 prompts/diffs/model text。保留期关闭遗留运行。 |
| PR 状态、堆叠、实时更新 | `worker/src/pulls/`、`worker/src/stack/`、`worker/src/live/` | pullState 读时计算，不存派生状态；原因只在 state.ts 扩展，批量取信号。状态变化按条件 INSERT 记事件，不逐 step。landTargetOf 与 base_ref 的职责分开；依赖图禁环，retarget CAS，禁止携带另一开放 PR 提交的 head 落地。实时消息只提示重取 API。 |
| MCP 与 OAuth | `worker/src/mcp/`、[认证](docs/authentication.md) | 列表只列 cloudforge_*，旧 gitorange_* 调用别名保留。JWT 本地验 audience 且每次检查当前 consent；Moderator 每次检查且复用实际审批规则。注销/撤销代数限制 consent/code/refresh/JWT，重连不复活旧凭据；userinfo/introspection/迟到写同样服从 D1 权威。 |
| 密码、因子与会话 | [认证](docs/authentication.md)、`worker/src/auth/` | 密码单独不能绕过启用因子；挑战、并发注册、跨挑战重放都 fencing；恢复码单次。禁信任设备/email OTP/秘密重导出，秘密只在页面内存，认证响应 no-store。因子变动撤销旧会话；密码改动保留因子/恢复码并清挑战，credential/factor generation 和活会话在写点复核，只有成功授权写能延续到下一代。 |
| 离线恢复与近期认证 | `worker/src/auth/recent.ts`、`worker/src/auth/assurance.ts`、安装器恢复命令 | reset-password 不隐式清 MFA；reset-mfa 明确安装/账户/库、成员、审计理由，preview/确认围栏，通过声明生成的原子 trigger 清因子/会话/挑战，保留密码与机器凭据。旧认证证据为 unknown，不从注册/刷新推断。近期认证需 5 分钟内密码及已启用因子；不可由模拟身份升级，单次 proof 与持久证据分离，session-bound prompt 仅重试明确未执行 challenge 一次。PAT/部署令牌插入在 SQL 再查 proof。 |
| 认证策略 | `worker/src/auth/policy.ts`、`worker/src/auth/policy-management.ts`（存在时） | 实例策略的发布与部署需分别核验；策略代数、预览摘要、会话与 credential/factor generation 的写点 CAS、受限会话白名单及最后管理员恢复均需实际源码与测试复核，不能凭旧文档推断。 |
| OIDC 绑定与 SSO 来源 | [外部身份](docs/oidc.md)、`worker/src/oidc/`、`worker/src/auth/assurance.ts` | 只按 issuer/sub 显式绑定，禁止邮箱自动关联、JIT 和 SDK 默认 provider。配置发布/停用以 D1 代数为准；回调先候选后二次确认，身份墓碑不可移交。外部主证明不记为 password，IdP amr 不替代本地因素；SSO 会话须独立保留绑定 revision/配置代数并持续核验，密码重验不能洗掉来源撤权。敏感操作仍要求近期本地密码与已启用因素。 |
| 审计、检索、设置 | `worker/src/lib/audit.ts`、`worker/src/lib/settings.ts`、`worker/src/lib/text-match.ts` | 新 mutation 加审计，禁止秘密/prompts/diffs；审计失败不抛业务错误。设置只在用处读取，部署事实留配置。D1 搜索用 instr 而非受长度限制 LIKE；集合超过 100 绑定时使用有界批次或 JSON 参数。 |
| Issue、通知 | [Issues](docs/issues.md)、[通知](docs/notifications.md) | Issue/PR 共享原子编号；库不代替 router/MCP 权限。标签/指派需写权限，代理不做人类指派；默认分支落地才关闭引用 issue。通知排除 actor、无权限、封禁、agent 等；待发邮件发送前重查权限/偏好/订阅，先清 pending 避免重复发送。 |
| Webhook 与状态 | [Webhook](docs/webhooks.md) | PAT 只在允许状态入口接受并限制 scope；checks 合并 Actions 与最新 context。Webhook 每仓最多 20，事件同写 outbox、稳定 id、claim fencing、14 天保留；AES-GCM 密钥不可读则不发。只读最多 2048 响应字节后取消；拒本地主机/私有 IP 字面量，不跟重定向，DNS 解析防护不能被假称已覆盖。 |
| Release | `worker/src/lib/releases.ts` | 版本标签仅从不存在创建，不移动/删除；release rows 与 pull 关联同批，新增提交按默认落地目标读取。首次发布明确版本；手推标签不当 release，永不重复用版本。 |
| 安装器 | [更新说明](docs/updating.md)、`scripts/cloudforge/` | 相同输入产生相同计划/命名/摘要；手写 wrangler 不覆盖。state/lock 不入库，仅碰带 ownership marker 的资源，支持 resume；upgrade 先 plan、不降级、不重写 setup secret，定制代码需明确替换授权。adopt 对云只读，Docker preflight 保留。发布包仅在本人机器核对 tag/origin/main、隔离构建测试并确认后 publish。 |

## 配置与生成文件

- `wrangler.jsonc` 被忽略；从 example 填自己的账号/资源，不提交真实 ID 或凭据。Artifacts 没有本地模拟器；开发用远端开发命名空间，测试用无 remote binding 的配置及内存 Artifacts fake。
- 新 binding/var 同步 `wrangler.jsonc.example` 的顶层及 env.dev、`wrangler.jsonc.ci`、需要时 `wrangler.test.jsonc` 和 `docs/configuration.md`，再 `yarn cf-typegen`。
- `AGENTS.md` 是项目规则单一来源，`CLAUDE.md` 是引用入口；`yarn agents:sync` 只生成该入口和 `.agents/skills/` 副本。技能原文在 `.claude/skills/`，用 `yarn agents:sync --check` 检查同步状态。
- 首次安装与 onboarding skill、`docs/setup.md` 和安装器 flags/messages 同步。安装、生产迁移、部署、推送均需人类明确授权；不作为收尾默认步骤。

## 数据库与验证要求

- 不手写或追加迁移：改 Drizzle 声明后 `yarn db:generate`，审查新 SQL；recovery/access trigger 与 `_triggers.json`、一次性数据声明与 `_data.json` 由生成器管理。生成认证 schema 不手改；改 auth config 后 `yarn auth:update` 再生成迁移。
- 新后端功能在 `worker/src/__tests__/` 写 Vitest；使用 workerd 真实 D1，不 mock env.DB，只注入 Artifacts fake。批量种数据避免逐行写超时。
- 完成标准保留：`yarn test`、`yarn typecheck` 通过并运行格式化。文档专项验证不可伪装成业务验收；CI 归属需要同步新增测试文件。

## Git、许可与签名

- 独立 fork 按 GPL-3.0-or-later 发布；原 Apache-2.0 许可原文不改。不向 upstream 推送，不重写已发布历史。
- 常规开发使用特性分支合入 main；共享工作区维护应保留当前分支与他人未提交修改；切分支、提交与推送须符合当前人类授权。
- Conventional Commits：`type(scope): 中文描述`，允许 feat/fix/refactor/docs/test/chore/ci/perf/build；正文 `文档:`，`git commit -s`，末尾实际 Agent 的完整 `Co-authored-by: Name <email>`。保留项目现有钩子约束，不绕过。
- 修改 upstream 文件保留/添加首行 fork notice；原文为 Modified by CyberNova for the CloudForge fork…Originally Apache-2.0。该要求同样适用于根文档与 Agent 文件。
- 保留 Husky、lint-staged 与跨平台 run-yarn 的既有检查；补充安全护栏与它们串联，操作说明见 docs/development.md 和 SECURITY.md。

## 维护入口

贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全报告见 [SECURITY.md](SECURITY.md)。
在新克隆中运行 `python tools/repo_maintenance_guard.py install` 接入补充护栏，再用 `python tools/repo_maintenance_guard.py status` 核对配置。安装保留原有钩子；补充护栏检查暂存内容、提交标题及推送新增历史，检查无法完成时阻止操作。项目原有更严格的署名、签名、分支和验收规则继续适用。安装是配置操作，不是业务验证。

## Repo docs

`repo-docs/` is the living guide; start with [the reading path](repo-docs/README.md) and [the main walkthrough](repo-docs/walkthroughs/one-real-run.md).
This repo's `repo-docs/` guide is reader-facing Chinese documentation. When updating reader-facing guide pages, use `repo-docs-zh` when available; keep Chinese reader handles in the prose and preserve exact source identifiers for lookup.
Read current source, scripts and tests before treating the guide as implementation truth. Repo questions, behavior changes, user uncertainty, stable knowledge discovered in conversation, and knowledge about to be saved to memory trigger a foreground sync gate with `repo-docs` Sync mode when available (otherwise inspect the guide and source manually).
Choose `none`, `answer-only`, `foreground patch`, or `background sync`. Patch the smallest owning page before the final answer when a durable local gap would mislead; use background sync only with a real tracked handoff and no answer-critical gap. Do not rewrite docs for transient debug state.
Update the walkthrough for input/output or boundary changes and the code map for responsibility changes. Record meaningful guide changes and actual verification in `repo-docs/change-log.md` with `Synced through <sha>`; do not imply unrun tests passed.

文档站基于 VitePress 默认主题扩展本地字体、昼夜切换与渐进动效（无 JS 时内容照常可见），构建输出独立于业务界面。
