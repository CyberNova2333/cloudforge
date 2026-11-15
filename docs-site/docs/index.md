# 第一阶段：项目概览、定位与能力边界

CloudForge 是一个**部署在你自己 Cloudflare 账户内的单租户自托管 Git 与协作平台**，基于 [choyiny/gitorange](https://github.com/choyiny/gitorange)（2026-10-22 分叉，上游 Apache-2.0，当前衍生版本以 AGPL-3.0-only 发布）持续演进。

与传统的虚机部署方案（GitLab、Gitea、Forgejo）不同，CloudForge 不运行常驻服务器或独立数据库进程：单个 Cloudflare Worker 同源承载 React 18 SPA 网页、OpenAPI REST 接口、Git Smart HTTP、Git LFS Batch 接口与 OAuth 2.1 `/mcp` 服务；元数据与状态存储在 D1，Git 对象与引用交给 Cloudflare Artifacts，大文件、Actions 日志与缓存落在 R2，持续集成运行在 Cloudflare Containers，智能审查与冲突解决接入 Workers AI / AI Gateway。

## 它解决什么问题，不适合什么场景

- **单租户一实例一组织**：实例内所有成员共享一个站点与至多一个全局共享团队命名空间，适合中小型工程团队、研究小组或个人主控私有代码平台，**不适合对外开放多租户 SaaS 注册**。
- **AI 原生协作与可控合并**：支持通过自带 `AGENT.md` 的内部仓库定义多位审查 Agent、用 `MERGE_RESOLUTION` 自动发现与线性化 PR 堆叠（不篡改开发者远端分支），并由统一的 `reviewVerdict` 门禁驱动变基快进落地。
- **编码代理无缝接入**：实现完整的 RFC 8414 / RFC 9728 / RFC 7591 OAuth 2.1 授权链路与无状态 Streamable HTTP `/mcp`，供 Claude Code、Codex、Cursor 等客户端领取议题、推送状态或（经明确授权后）代决普通审查意见。

## 必须提前了解的平台硬边界

| 维度               | 当前事实与限制                                             | 工程应对与建议                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git 传输协议**   | **不支持 SSH**（Cloudflare Workers 不能监听 22 端口）      | 全量使用 HTTPS + 个人访问令牌（PAT）或仓库级部署令牌（`cfd_`）                                                                                                        |
| **Artifacts 上限** | 新建的 Artifacts 仓库上限 **1 GB**，推送仅支持 Git 协议 v1 | 二进制模型、视频、大包体资产务必接入内置 **Git LFS（直传 R2）**                                                                                                       |
| **D1 并发与参数**  | SQLite 单线程写入，单条 SQL 绑定参数上限 **100 个**        | 批量通知、标签、清理与恢复任务均按分片批处理实现                                                                                                                      |
| **功能非目标清单** | 当前版本明确不包含以下能力                                 | 议题里程碑/模板、跨仓库引用 `owner/repo#N`、Webhook 按分支过滤、多 OIDC 提供商并存、外部通行密钥（Passkey）、SSH 部署密钥、公开跨仓库 Fork/PR、仓库转移与一键导出备份 |

::: tip 下一步去哪里
准备向 Cloudflare 部署实例？继续阅读 [多模式部署与运维](/docs/deployment) 与 [绑定、变量与实例设置](/docs/configuration)。
:::
