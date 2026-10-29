# CloudForge 源码证据

这是调查台账：解释主流程的依据与边界，不能替代运行日志。源码锚点为 `8e716e548e70555a7933d3b8575f25399a07e809`；本轮还读取了当前工作树，未提交内容不等于已交付版本。

## Evidence Traversal Log

| Pass   | Purpose                  | Inspected evidence                                                                                                                                              | What changed in the model                                                                                        |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Pass 1 | 建立输入、状态和输出路径 | `worker/src/git-http.ts`, `worker/src/git/push-protection.ts`, `worker/src/git-http.ts`；根 README、package 或构建入口、Agent 规则                              | 固定 walkthrough 的代表性行为，并列出交接位置。                                                                  |
| Pass 2 | 反查失败与遗漏依赖       | `worker/src/__tests__/git-http.test.ts`, `worker/src/__tests__/push-protection.test.ts`, `worker/src/__tests__/push-events.test.ts`；配置、已有文档与范围内目录 | 复查引用保护、部署凭据首次推送、成功引用筛选与事件恢复测试；确认 HTTP 成功、引用成功和后续完成是三个不同观察点。 |

## 证据表

| Claim                    | Evidence                                                                                                          | Confidence | Caveat                           | Used by                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------- | --------------------------------------------------------------------- |
| 请求先取得仓库权限       | [源码定位](../../worker/src/git-http.ts)：`authenticateRepoRequest、handleGitRequest`                             | Confirmed  | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 引用变动先经过保护       | [源码定位](../../worker/src/git/push-protection.ts)：`decidePush；在入口中搜索 readReceiveRequest 与 deployToken` | Confirmed  | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 存储回复决定哪些更新成立 | [源码定位](../../worker/src/git-http.ts)：`successfulPushRefs、applied、recordPush`                               | Confirmed  | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 先记事件，再返回推送结果 | [源码定位](../../worker/src/lib/push-events.ts)：`recordPush、afterPush、runPushEvent`                            | Confirmed  | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |
| 中断后按事件恢复         | [源码定位](../../worker/src/__tests__/push-events.test.ts)：`“后台被中断的事件”与“同一仓库的下一次推送”用例`      | Confirmed  | 源码静态确认；本轮未运行业务路径 | [主流程](../walkthroughs/one-real-run.md)、[代码地图](../code-map.md) |

## 反证与后续问题

反证检查（Falsifying check）：若 git-http 测试允许只读令牌写入，或 push-events 测试显示回复前未持久化事件，主流程模型即需修订。

下一位读者可能问（Next reader question）：推送后 PR 如何进入人工审查？既有 docs/auto-merge.md 解释该路径，本指南暂缓逐段追踪。

## 范围与未验证事项

覆盖 Git HTTPS 推送入口、引用保护、Artifacts 交接和持久化推送事件；只追踪这些目录内与推送有关的文件。PR 审查、合并、Actions 执行器、OAuth/MFA、MCP、安装器、SPA 与其他数据库模块留给既有 docs 专题，本包不声称完整架构覆盖。工作区中的认证策略与 UI 改动未提交，不据此声明已发布。

上述定向命令只验证 Git 主流程；全项目要求仍以根 AGENTS 和 docs/development.md 为准。本轮只运行文档校验与文档站构建，不运行 workerd、迁移或真实推送。

本轮文档结构校验与站点构建结果记在[同步记录](../change-log.md)。源码链接在仓库阅读时指向真实文件；独立站点只发布指南；文档目录之外的仓库源码链接在网页中显示为精确路径，源码不随站点打包。原始 Markdown 保留本地可核对链接。已有 VitePress 使用原文包含，正文只维护一份。
