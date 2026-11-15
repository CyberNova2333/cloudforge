<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# CloudForge 文档质量复核

这是审核记录，用于评估升级为 Standard 模式的工程指南包是否讲清端到端主路径与四大模块边界，并标注仍需结合代码或实际运行验证的风险点。

## Reader Simulation

| 读者问题                       | 从指南能得到的答案                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 从哪里进入，看到什么输出？     | [阅读指南首页](../README.md) 按目标将读者分流至推送主流程与四个核心模块，[一次真实主流程](../walkthroughs/one-real-run.md) 明确列出正常分支推送、只读拒绝、未初始化拒绝与恢复情形的输入和输出。                                     |
| 难点与核心压力是什么？         | 无状态 Workers 与单线程 D1（100 参数上限）无法与 `Cloudflare Artifacts` 或 R2 构成跨服务原子事务，同时不能信任未经校验的仓库代码或模型输入，因此系统必须在入口保护、预签名隔离、`push_events`/检查点恢复以及写点 CAS 之间显式划界。 |
| 分成哪些阶段或模块？           | 先经 `walkthroughs/one-real-run.md` 走通 5 步 Git 推送与恢复路径，再分别沿 `modules/` 四篇深入存储隔离、审查堆叠与落地、Actions 容器与 Webhook 出站重试、会话 MFA/OIDC/MCP 与权限兼容内核。                                         |
| 失败边界与限制在哪里？         | 每篇模块均提供正常与拒绝/失败对比表（如部署令牌无默认分支禁推、guarded Agent 禁空原因批核、内网 Webhook SSRF 拒绝、协议不满足返回 503），并给出 `worker/src/` 与 `scripts/` 的精确文件路径用于反查。                                |
| 怎样验证当前描述仍与源码一致？ | 指南末尾给出 `validate_repo_docs.py` 与 `pnpm --dir docs-site docs:build` 命令，[代码地图](../code-map.md) 列出各领域测试入口；所有实际通过记录与限定条件均记在 [指南变更记录](../change-log.md)。                                  |

## 可理解性与剩余风险

本轮改造将 `repo-docs/` 从 Lite 模式扩充为 Standard 模式，补齐 `modules/` 四篇专题与 `glossary.md`，同时保留既有的五步推送 walkthrough 与按目录映射的 `code-map.md`。正文均先讲行为与压力约束、再落到代码符号与实例对照，避免直接罗列文件名或堆砌抽象评价词。

反证检查（Falsifying check）：若实际源码中存在绕过 `access_runtime_state` 入口准入的业务突变端点、或 `/mcp` 列表暴露出未标记 `mcp_moderators` 时的批准工具、或 `ActionsQueue` 槽位限制未覆盖到单个 `JobRunner` 实例启动路径，则对应模块说明需要立即推翻并按新源码重校。

后续问题（Next reader question）：如果要基于本地克隆定制审查 Agent 或修改前端 i18n 词典并在真实本地 `workerd` 跑通测试，具体该如何操作？该部分工作流、命令与测试分组已同步整理至 `docs-site/` 第二阶段与第三阶段页面，源码侧也可对照 [开发说明](../../docs/development.md) 核实。

本轮质量复核与后续校验范围见 [源码证据与两遍调查](source-evidence.md) 与 [指南变更记录](../change-log.md)。
