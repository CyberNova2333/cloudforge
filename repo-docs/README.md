<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# CloudForge 源码阅读指南

成员向仓库推送一条分支或部署一只 AI 审查 Agent 时，CloudForge 必须在无状态 Cloudflare Workers 与单线程 D1（每句 100 参数上限）约束下，同时守住仓库权限、Git 引用保护以及后续工作流的断点恢复。本指南从一次推送主路径切入，再用四个专题模块拆解存储、审查堆叠、容器 Actions 与认证网关，帮助维护者区分“对象已写入”和“后台状态已收敛”。

## 阅读路径

| 读者目标                           | 从这里开始                                                                          | 读完后获得什么                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 理解一次真实推送主流程             | [主流程与拒绝边界](walkthroughs/one-real-run.md)                                    | 看懂请求如何通过协议门控、引用保护、`Cloudflare Artifacts` 交接与 `push_events` 恢复         |
| 掌握 Git、Artifacts 与 R2 LFS 边界 | [Git 传输、Artifacts 隔离与对象存储](modules/git-and-storage.md)                    | 区分 HTTPS 令牌隔离、部署令牌限制与 15 分钟 LFS 预签名对象生命周期                           |
| 追踪 AI 审查、PR 堆叠与合并门禁    | [AI 审查、PR 堆叠与自动落地](modules/reviews-stacking-and-merge.md)                 | 理解 `AgentReviewer`、`MERGE_RESOLUTION`、无重推堆叠与 `landPull` 落地恢复                   |
| 排查 Actions 容器与出站通知        | [Actions 容器调度、提交状态与 Webhooks](modules/actions-containers-and-webhooks.md) | 掌握 `ActionsRun`/`JobRunner`/`ActionsQueue` 槽位、`cloudforge/relevance@v1` 与 Webhook 重试 |
| 核对认证策略、OIDC 与 MCP 隔离     | [身份认证、OIDC 与访问边界](modules/auth-oidc-and-access.md)                        | 分清 Cookie 直读、强制 MFA、`access_runtime_state` 门控与 OAuth 2.1 `/mcp` 边界              |
| 定位目录职责与测试入口             | [按职责找代码](code-map.md)                                                         | 在按领域拆分的 `worker/src/`、`src/` 与 `scripts/` 目录中找到源码与回归测试                  |
| 查询项目专有术语                   | [术语表](glossary.md)                                                               | 对齐 `land_target`、`pr_edges`、`reviewVerdict`、`AGENT.md` 与 `compat-v1` 等命名语义        |
| 审核源码证据与边界                 | [源码证据与两遍调查](references/source-evidence.md)                                 | 核对关键结论对应的源码位置、局限性与待证条件                                                 |
| 复核可读性与剩余风险               | [读者模拟与剩余风险](references/quality-review.md)                                  | 检查五项核心读者问题是否均有正面回答及尚未覆盖的运行边界                                     |
| 查看同步锚点与验证记录             | [指南变更记录](change-log.md)                                                       | 追踪每次同步对应的提交锚点与实际运行过的命令范围                                             |

## 覆盖范围与定位

本目录采用标准版（Standard）结构维护工程内架构与原理文档，面向需要修改源码、编写回归测试或排查边界竞态的维护者；所有面向实例部署、API 使用与版本迁移的对外说明则统一发布于 `docs-site/`（双语四阶段官方文档站，并通过 VitePress `@include` 与 `docs-site/.vitepress/guide-links.mts` 复用本目录内容）。源码、迁移与实际测试执行才是运行事实的最终依据，页面中列出的校验脚本并不自动代表当前部署或生产状态。

## 本地验证入口

```sh
pnpm install --frozen-lockfile
pnpm dev
# 工程文档结构与索引校验：
python3 ~/.gemini/skills/repo-docs/scripts/validate_repo_docs.py --repo-root . repo-docs
# 文档站静态构建（docs-site 依赖隔离于根工作区）：
pnpm --dir docs-site install --frozen-lockfile
pnpm --dir docs-site docs:build
```

需要核对前端路由、部署 CLI 或详细接口字段时，可从 [按职责找代码](code-map.md) 继续查找，或访问 `docs-site/` 中的分阶段说明页（`docs/setup.md`、`docs/configuration.md` 等底层契约专题亦保留在 `docs/` 下）。

证据状态：除特别标注外，本页基于当前源码已确认。
