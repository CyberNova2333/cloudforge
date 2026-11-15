<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# AI 审查、PR 堆叠与自动落地

在 [一次真实主流程](../walkthroughs/one-real-run.md) 完成分支推送后，CloudForge 的差异化工作流集中在 `MergeResolutionWorkflow`（绑定 `MERGE_RESOLUTION`）与合并网关 `landPull`。整条链路需要解决三个彼此牵连的问题：无服务器环境下如何让多 Agent 深度审查安全执行、如何把多个开放 PR 组织成无环堆叠线而不重推用户分支、以及如何在 D1 与 Artifacts 无分布式锁的情况下完成最终落地与回滚保护。

## 审查引擎与自学习闭环

仓库管理员邀请的审查 Agent（上限 10 个）实质上是带有 `AGENT.md` 的内部仓库（`<handle>/<handle>`），默认分支被推送后会自动刷新配置，无效 frontmatter 记入 `config_error` 而不覆盖上一次有效规则。对于 `engine: pass` 的 Agent，审查直接在 Workers AI 上单轮完成；对于 `engine: pi` 的深度审查，Workflow 在 `review:<handle>` 步骤启动以 `<pr_reviewers.id>:<created_at>` 命名的独立 Durable Object `AgentReviewer`（`worker/src/review/agent-reviewer.ts`）：

1. 检出模块 `worker/src/review/checkout.ts` 将变更文件优先同步到隔离 SQLite 工作区的 `/repo`，跳过二进制、符号链接、lockfile 与 `.orangeignore` 匹配项（上限 3,000 文件或 24 MB，超出清单写入 `/review/not-checked-out.txt`）。
2. 只读工具（`read`、`ls`、`find`、`grep`）受 `review.pi_max_tool_calls` 等设置预算约束；若未配置 `AGENT_REVIEWER` 绑定，自动回退为单轮 Pass 并标注原因。
3. PR 关闭且存在被人类批准（dismiss）的 `change_requested` 或附带 teach note 的决定时，`worker/src/learn/lessons.ts` 写入 `agent_lessons` 并由 `worker/src/learn/run.ts` 在隔离 `/agent` 工作区内仅允许修改 `AGENT.md` 正文与 `knowledge/**`（`worker/src/learn/validate.ts` 校验 frontmatter 字节完全一致后再 CAS 提交）。

```yaml
---
name: security-reviewer
facet: security
guarded: true
engine: pi
trigger:
  ask: review authentication, D1 queries and permission boundaries
---
检查所有状态变更写点是否保留最终授权校验。
```

## PR 堆叠发现与 `land_target` 重定向

多个开放 PR 同时修改同一目标分支时，`worker/src/stack/lineage.ts` 先用 Git 提交历史与 `worker/src/git/patch-id.ts` 判定血缘：若某 PR 完整包含另一 PR 的提交，直接写成由 `git` 判定的 `pr_edges`，不消耗 AI 配额；其余仅共享部分基线或存在潜在耦合的 PR 经 Clef 与推理模型评估后，由 `worker/src/stack/acyclic.ts` 消除环路再条件写入 `pr_edges`。

`worker/src/stack/reconcile.ts` 随后仅在 D1 批处理中更新 `pull_requests.base_ref`（临时指向父 PR 头分支）并保留 `land_target`（最终落地分支），系统从不替开发者篡改远端分支指针。`worker/src/pulls/state.ts` 再依据 `reviewVerdict`、检查状态与 `worker/src/stack/gate.ts` 在读取时动态计算 PR 状态（`agent_followup` > `human_review` > `waiting` > `ready`）。

| 场景对比                                    | 门禁 `reviewVerdict` 与 `landPull` 判定                     | 持久化与恢复行为                                                     |
| ------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| guarded Agent 提出 `needs_person` 意见      | 禁止空原因批准（422），也不能通过 `ai_delegations` 自动代决 | 必须由非作者（除非开启 `allow_self_approval`）填写理由并决定后才放行 |
| 父分支仍未合并的子堆叠 PR 点击合并          | `stackGate` 拒绝落地（HTTP 409），状态显示 `stacked_on`     | 仅在父 PR 落地并用 `reconcile` 退回 `land_target` 后解锁             |
| 合并推进 Artifacts 成功但关闭关联议题前崩溃 | `worker/src/merge/landing-recovery.ts` 按检查点保留进度     | 由后续请求或每日清理继续关闭 `Fixes #N` 议题并派发通知               |

最终合并入口 `worker/src/merge/land.ts` 对目标分支执行 rebase + fast-forward 并使用 CAS 检查头指针，随后由 `worker/src/pulls/close-recovery.ts` 或 `landing-recovery.ts` 将子堆叠回退、`delete_merged_branches` 清理、通知、Webhook 与 `agent_lessons` 作为幂等检查点收尾。更多入口路径与运行记录位置见 [Actions 容器与出站通知](actions-containers-and-webhooks.md) 及 [代码地图](../code-map.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
