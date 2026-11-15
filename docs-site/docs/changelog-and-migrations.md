# 第四阶段：数据库迁移、升级门禁与关键架构决策

本页汇总从上游分叉基线以来的关键架构决策（ADR）、D1 结构演进轨迹（`migrations/0000`–`0066`），以及升级现有实例时必须理解的兼容性与排空门禁。详细同步流水台账记录在仓库 `repo-docs/change-log.md`。

## 1. D1 数据库迁移阶段一览（`0000`–`0066`）

所有迁移文件按顺序存放在 `migrations/`，由 Drizzle 声明（`worker/src/db/app.schema.ts`、`auth.schema.ts`、`release.schema.ts`）配合 `scripts/database/generate-db.mjs` 生成，并登记在安装器清单中：

| 迁移范围      | 演进内容与影响说明                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000`–`0039` | 基础单租户模型：成员、仓库、协作者、PR、审阅、Actions 容器、Artifacts 元数据与 OAuth 客户端                                                     |
| `0040`–`0044` | 安全审计与可靠性加固：实例级密钥仓库白名单、推送保护、作者自批隔离、`merge/landing` 恢复边界与 Actions 单库并发上限                             |
| `0045`        | 议题模块（`issues`、`issue_comments`、`labels`、`issue_labels`、`issue_assignees`、`issue_events`、`issue_links`），与 PR 共用 `next_pr_number` |
| `0046`        | 站内通知收件箱、订阅与仓库关注（`notifications`、`notification_subscriptions`、`repository_watches`）                                           |
| `0047`–`0048` | 外部提交状态与出站 Webhooks（`commit_statuses`、`webhooks`、`webhook_deliveries`）及 Actions 容量查询索引                                       |
| `0049`–`0055` | 双因素认证（TOTP）、一次性恢复码、独立离线恢复日志与浏览器近期认证代际约束                                                                      |
| `0056`–`0061` | 管理员强制 MFA 策略与预览、OIDC 显式绑定、全局停用与确认触发器围栏、SSO 候选确认与私有会话来源（`sso`）                                         |
| `0062`–`0066` | 授权写点 triggers、安装与版本发布收据表（`release.schema.ts`）、兼容访问控制桥接状态（`access_runtime_state`、`compat-v1`）与最终权限声明对齐   |

## 2. 生产升级工作流与权限兼容过渡

### 使用 CLI 升级与恢复

```bash
# 查看已记录安装与线上迁移状态
pnpm dlx @cybernova2333/cloudforge status --name <实例名>

# 1. 多团队迁移准备前：只读检查数据结构与触发器一致性
pnpm cloudforge access-preflight --name <实例名>

# 2. 切换或升级前：只读观察 D1 六类在途任务（Actions / Runner / Agent / push_events）
pnpm cloudforge access-drain-status --name <实例名>

# 3. 执行受预检与指纹保护的完整升级
pnpm dlx @cybernova2333/cloudforge upgrade --name <实例名>
```

### 兼容性与回滚红线（必读）

- **`upgrade` 拒绝不完整或未知协议库**：CLI 在交互确认前与写入前都会重核目标协议、67 个迁移脚本摘要指纹以及已有表/受管触发器状态；存在冲突（如多行旧团队、用户名/slug 归一化碰撞）时直接阻断，绝不猜选或静默覆写。
- **`access-preflight` 与 `access-drain-status` 的结论适用范围**：退出码 `0` 表示“本次有界观察（每类上限 1000 条）未发现结构异常”，**不授权后续写操作**，也**不证明云端 Workflow 或具有 300s 延迟更新特性的 Durable Objects 已全部切换或清空**；`rolePublishingAllowed` 与 `rollbackSafe` 当前始终为 `false`。
- **禁止对已推进协议的库回滚到旧版 Worker**：`access_runtime_state` 单例禁止删除或降级最低协议；若数据库已升至更高最低协议，必须保持支持该协议或更新的 Worker 运行，历史未带入口校验的旧 Worker 无法接受此状态保护。

## 3. 关键架构决策（ADR 摘要）

| 决策议题                                | 选择方案                                                                                             | 舍弃方案与核心权衡                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Git 存储选型**                        | `Cloudflare Artifacts` 存 Git 对象，D1 仅存仓库与业务元数据，R2 承接 LFS                             | **舍弃在 D1/R2 自建 packfile 索引**：避免 Worker CPU/内存爆表并简化协议实现，权衡为需接受上游 Artifacts 1 GB 单库限制及仅协议 v1。        |
| **深度 AI 审查沙箱**                    | 每次 `engine: pi` 尝试绑定一次性 `AgentReviewer` DO（隔离 SQLite 工作区），限制只读工具与 Token 预算 | **舍弃全量传入 Diff 或永久共享单 DO**：避免上下文溢出及跨尝试污染；缺失 DO 绑定时优雅退回单轮 Pass。                                      |
| **PR 堆叠重排机制**                     | 仅改写 D1 的 `base_ref`（保留 `land_target`），从不自动向用户开发分支强推 rebase 提交                | **舍弃自动改写远端开发者分支**：避免破坏本地历史或产生隐藏冲突，只在最终 `landPull` 落地目标分支时执行变基快进。                          |
| **入口协议准入（`runtime-bridge-v1`）** | 在 HTTP/Git/LFS 与后台任务入口前先查 D1 `access_runtime_state` 并统一 fail-closed 503                | **舍弃只在发布说明约定停机或仅依赖 env 开关**：env 仅作用于单个 isolate 而非全局 D1 状态，D1 守卫为未来多团队五级角色演进建立可验证底线。 |
| **`/mcp` 鉴权隔离**                     | 独立 OAuth 2.1 资源与受众校验 + `mcp_moderators` 显式授权才开放批准类工具                            | **舍弃复用 PAT 访问全部端点或自动向普通客户端暴露审批工具**：防止无约束编码代理在未获单独同意时自批高风险变更。                           |
