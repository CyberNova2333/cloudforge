# CloudForge 定位与路线图

本文记录项目的定位、到目前为止做了什么、还没做完什么，以及接下来的规划。路线图随实现推进更新。

## 定位

CloudForge 是一个**单租户、自托管在 Cloudflare 上的 GitHub Enterprise Server 式代码平台**，面向想自己掌握代码与数据的团队：

- **一个实例一个组织**：部署在自己的 Cloudflare 账户里，一个 Worker 同源提供 API、网页（React SPA）和 git 端点；元数据在 D1，git 对象与引用在 Cloudflare Artifacts，LFS 与 Actions 日志/缓存在 R2，Actions 作业跑在 Cloudflare Containers。没有服务器要运维。
- **GitHub 的日常协作功能**：仓库、分支、拉取请求、Actions（兼容 GitHub 工作流语法与常用 action）、LFS、发行版、议题、通知、Webhooks 与提交状态、审计日志。
- **差异化：AI 代理参与的合并流程**：审查代理（每个代理是一个带 `AGENT.md` 的仓库）按需审查每个头部提交，提出需要人决定的问题或修改请求；CloudForge 自己做变基 + 快进合并、AI 冲突解决、PR 叠放（stacking）判定、合并队列与自动合并；代理从人的决定中学习（更新自己的知识）；编码代理通过 MCP（OAuth 2.1）直接领取议题、开 PR、读状态。
- **目标用户**：想从 GitHub 迁出、又想要“代理审查 + 自动落地”工作流的中小团队；也适合作为个人或实验室的私有代码平台。

需要提前接受的平台限制：不支持 SSH（Workers 不能监听 22 端口，只能 HTTPS + 令牌）；新建的 Artifacts 仓库上限 1 GB、推送只支持协议 v1（大仓库要用 LFS）；D1 单线程、每条语句最多 100 个参数（高写入功能都按批量写入和后台处理设计）。

## 已完成（相对 `origin/main` 6f7a22a）

四个分支依次叠在一起，按顺序合并：

| 分支                 | 内容                                                                                                                                                              | 迁移      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `fix/security-audit` | 安全审计与修复（实例级密钥按仓库白名单、推送保护、作者自批、zod 升级与数组上限等）、可靠性（推送后处理、删除仓库、落地恢复）、性能项、Actions 每仓库并发上限      | 0040–0044 |
| `feat/issues`        | 议题、评论、标记、指派人、时间线；与 PR 共用编号；`Fixes #N` 合并时关闭；`#N` 链接；MCP 5 个工具；网页（列表、新建、详情、标记管理）                              | 0045      |
| `feat/notifications` | 站内收件箱（铃铛、`/notifications`）、订阅与仓库关注、@提及、邮件（每人可选）；MCP 2 个工具                                                                       | 0046      |
| `feat/webhooks`      | 提交状态 API（外部 CI 用个人访问令牌上报，参与合并门禁）、Webhooks 后端（签名、出站队列、退避重试、投递记录、重新投递、测试 ping、地址限制）、每 5 分钟的定时任务 | 0047      |

设计与行为说明见 `docs/issues.md`、`docs/notifications.md`、`docs/webhooks.md`；升级步骤见 `docs/updating.md`。

## 当前阶段没有做完的

### Webhooks 与提交状态（`feat/webhooks`）

后端、接口、门禁、测试和文档已完成；以下部分没做：

- **网页：仓库设置 → Webhooks**：列表、新建（地址、密钥、事件、启用）、编辑、删除、投递记录（请求体、响应码、前 2 KB 响应、耗时、错误）、重新投递、发送测试。接口已全部可用（`/api/repos/{owner}/{repo}/hooks…`），在页面做好之前只能用接口管理。
- **网页：检查框与检查徽章显示外部状态**：`GET …/commit-statuses` 已返回 `statuses`，`src/lib/uiApi.ts` 的类型和检查框、提交列表徽章还没有用上；PR 状态原因里 `run_number` 为 0 的检查失败已能正确显示（不带“运行 #N”）。
- **网页：访问令牌页说明**令牌可以调用提交状态接口（Bearer）。
- **MCP 工具**：`cloudforge_create_commit_status`、`cloudforge_get_commit_status`（`worker/src/mcp/` 新文件，注册后更新 MCP 工具列表与数量的测试）。
- 上述网页部分的中文翻译与截图检查。

后续可做（`docs/webhooks.md`“以后”）：实例级 webhook、按分支过滤事件、表单编码请求体、连续失败自动停用、**必需检查**（与分支保护规则一起做）。

### 已交付功能里明确“这一版不做”的

- 议题：里程碑、议题模板、跨仓库引用 `owner/repo#N`、直接推送到默认分支时提交信息里的关闭关键字、拉取请求的标记。
- 通知：提交、发行版、Actions 失败的通知；回复邮件即评论；每日摘要邮件；编辑正文时新增的 @ 不通知。
- 集成：**部署密钥**（路线图第一阶段第 3 项的一部分）没有做；Webhook 负载只是 GitHub 字段的子集。

### 交付相关

- 我推送不了 CNB（没有凭据），所有提交都在 `cloudforge-all.bundle` 里，需要你导入后推送并按上表顺序合并。
- 部署前依次执行迁移 0040–0047，并在自己的 `wrangler.jsonc` 的 `triggers.crons` 里加上 `*/5 * * * *`（见 `wrangler.jsonc.example`）。没有部署任何东西。

## 规划

### 第一阶段：日常协作必备（进行中）

1. 议题 —— 已完成（里程碑、模板待做）。
2. 通知 —— 已完成。
3. 集成接口 —— 提交状态、Webhooks 后端已完成；**下一步先补完 Webhooks 网页与 MCP 工具**，再做部署密钥（仓库级只读/可写 SSH 不可行，做成仓库级 HTTPS 令牌）。

### 第二阶段：单租户企业部署的门槛

4. **SSO 与双因素认证**：better-auth 的 twoFactor、passkey、genericOAuth/SSO 插件；站点管理员可要求全员启用。
5. **多团队与细分角色**：用多个团队（或组织）替换“唯一共享团队”，引入 read / triage / write / maintain / admin 五级仓库角色；牵动 `permissionsFor`/`visibleTo` 与大量路由，先写设计文档。
6. **分支保护规则**：必需检查（Actions 作业与提交状态 context）、所需批准人数、CODEOWNERS、受保护标签、规则是否约束管理员；替换现在的固定推送保护。
7. **运维**：每个仓库导出 git bundle + D1 导出的备份；显示存储用量（Artifacts 1 GB 上限）；仓库归档与转移。

### 第三阶段：生态与代码体验

8. **兼容部分 GitHub REST API**（repos、pulls、issues、statuses）与令牌认证，让 `gh`、IDE 插件、Renovate 等现成工具可用；Webhook 负载向 GitHub 格式靠拢。
9. **代码浏览**：blame、文件历史、代码搜索（Artifacts 没有索引，需另建，只索引默认分支，D1 FTS 或 Cloudflare 搜索服务）。
10. **外部贡献者**：公开仓库的 Fork 与跨仓库 PR。

更往后：Packages、Pages、Wiki、Projects。

### AI 代理方向（贯穿各阶段）

- 代理领取议题 → 开 PR → 审查 → 自动落地的闭环（议题、通知、提交状态已为此铺路）。
- 外部 CI 的结果（提交状态）进入代理审查与 Let Claude decide 的上下文。
- 代理学习的可视化与回滚（哪些知识来自哪次人的决定）。

### 工程习惯（沿用）

一个功能一个分支，先写中文设计文档；每个提交带测试；改行为时同步 `docs/updating.md`、`docs/architecture.md`、`CLAUDE.md`（再 `yarn agents:sync`）；新测试文件登记到 `.github/workflows/ci.yml`；每次交付一个包含从 `origin/main` 起全部分支的完整 bundle。
