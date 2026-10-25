# 议题（Issues）

议题是仓库里的问题与任务记录：标题、正文、评论、标记（label；界面里不叫“标签”，以免与 git 标签混淆）和指派人，开着或已关闭。它与拉取请求共用编号，`#12` 在一个仓库里只指一样东西；拉取请求的标题或正文写 `Fixes #12`，合并进默认分支时就关闭 #12。本文是设计说明，也是行为说明：实现以它为准，改行为时一并更新。

## 数据

全部在 D1（`worker/src/db/app.schema.ts`，迁移 `0045`），仓库删除时级联删除。

| 表                | 内容                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issues`          | `number`（与拉取请求共用 `repositories.next_pr_number`）、`title`、`body`、`author_id`、`state`（`open`/`closed`）、`state_reason`（`completed`/`not_planned`）、关闭者与关闭它的拉取请求、时间 |
| `issue_comments`  | 评论：作者、正文、时间                                                                                                                                                                          |
| `labels`          | 每仓库的标记：名称（仓库内不分大小写唯一）、颜色（6 位十六进制）、说明                                                                                                                          |
| `issue_labels`    | 议题 ↔ 标记                                                                                                                                                                                     |
| `issue_assignees` | 议题 ↔ 指派人                                                                                                                                                                                   |
| `issue_events`    | 时间线事件：`closed`、`reopened`、`labeled`、`unlabeled`、`assigned`、`unassigned`、`renamed`、`referenced`（被拉取请求提到）                                                                   |
| `issue_links`     | 拉取请求 ↔ 议题：`closes` 为真表示关闭关键字，否则只是提到                                                                                                                                      |

另加 `repositories.has_issues`（默认开）：关掉后议题页和接口对这个仓库不可用（已有数据保留，重新打开即恢复）。Agent 的仓库不显示议题标签页。

**编号**：新建议题与新建拉取请求用同一个原子操作领号（同一个 batch 里先把 `next_pr_number` 加一，再插入并读取加过的值），所以两者编号不会重复，数据库也不需要跨表约束。编号从不回收：删除议题后它的编号不会再分配。`/<owner>/<repo>/issues/<n>` 指向拉取请求时页面跳到 `/pull/<n>`，反之亦然。

## 权限

沿用 `permissionsFor`（`worker/src/lib/repos.ts`），不新增角色：

| 操作                     | 谁可以                                                 |
| ------------------------ | ------------------------------------------------------ |
| 看议题、评论、标记       | 能读仓库的人；public 仓库的未登录访客也可以（只读）    |
| 新建议题、评论           | 能读仓库的已登录成员                                   |
| 编辑议题标题和正文       | 作者，或有推送权限的人                                 |
| 关闭、重新打开           | 作者，或有推送权限的人                                 |
| 编辑、删除评论           | 评论作者，或有推送权限的人（删除别人的评论记审计日志） |
| 给议题加减标记、指派人   | 有推送权限的人                                         |
| 新建、修改、删除仓库标记 | 有推送权限的人（记审计日志）                           |
| 删除议题                 | 仓库管理员（记审计日志）                               |
| 开关 `has_issues`        | 仓库管理员（仓库设置）                                 |

指派人只能是对这个仓库有推送权限的成员，不能是 Agent。上限：标题 256 字符，正文和评论 65536 字符，每个议题最多 20 个标记、10 个指派人，每个仓库最多 200 个标记。

## 与拉取请求的关联

- 拉取请求新建和修改标题、正文时（网页、API 与 MCP 同一处：`lib/issue-links.ts`），解析其中的 `#N`：`close`/`closes`/`closed`/`fix`/`fixes`/`fixed`/`resolve`/`resolves`/`resolved` 后跟 `#N` 为关闭关键字（不分大小写，可带冒号），其余 `#N` 只是提到。只认同一仓库里确实存在的议题编号，忽略代码块里的内容。结果整体替换这个拉取请求在 `issue_links` 里的行；新出现的提到在议题时间线上记一条 `referenced`。
- 拉取请求合并时，如果落地目标是默认分支，`finishLanding`（`merge/landing-recovery.ts`）的 `issues` 步骤把它关闭关键字指向、仍开着的议题关闭为 `completed`，记下关闭它的拉取请求和 `closed` 事件。这一步和其他落地后续一样有检查点，失败时由每日恢复重试；重复执行没有副作用（只更新仍开着的议题）。合并进非默认分支（例如堆叠的父分支）不关闭议题，等它最终落到默认分支时再关。
- 议题页列出关联的拉取请求（打开、已合并或已关闭）；拉取请求页列出它会关闭的议题。
- 暂不处理：直接推送到默认分支的提交信息里的关键字、跨仓库引用（`owner/repo#N`）、议题之间的引用。

## 接口

都在 `/api/repos/{owner}/{repo}` 下（`routers/issues-router.ts`），成功的写操作经现有的中间件推送实时更新（频道 `repo:<id>`）：

- `GET /issues?state=open|closed|all&q=&label=&assignee=&author=&page=&limit=`：列表，按编号倒序，带开/关计数与总数。`q` 匹配标题或编号（`instr`，见 `lib/text-match.ts`）。
- `POST /issues`：新建（可同时给标记和指派人，需推送权限）。
- `GET /issues/{n}`：详情、评论、事件、标记、指派人、关联的拉取请求。编号属于拉取请求时 404 并带 `pullNumber`。
- `PATCH /issues/{n}`：标题、正文、`state` 与 `stateReason`、`labels`（名称数组，整体替换）、`assignees`（用户名数组，整体替换）。
- `DELETE /issues/{n}`：删除（管理员）。
- `POST /issues/{n}/comments`，`PATCH`/`DELETE /issues/{n}/comments/{id}`。
- `GET /labels`，`POST /labels`，`PATCH`/`DELETE /labels/{id}`。

仓库详情（`GET /api/repos/{owner}/{repo}`）增加 `openIssueCount` 与 `hasIssues`。

## MCP

`mcp/issue-tools.ts`：`cloudforge_list_issues`、`cloudforge_get_issue`、`cloudforge_create_issue`、`cloudforge_update_issue`（标题、正文、开关、标记、指派人）、`cloudforge_comment_issue`。权限与网页相同。`cloudforge_create_pull_request` 的说明提示在正文写 `Fixes #N` 以在合并时关闭议题。

## 网页

- 仓库标签页“议题”（在“拉取请求”前；`has_issues` 关闭或 Agent 仓库不显示）。
- `issues`：列表，筛选打开/关闭、标记、指派人，搜索与分页。
- `issues/new`：新建。
- `issues/:number`：标题、状态、正文与评论、事件时间线，评论框带“关闭/重新打开”，侧栏是指派人、标记与关联的拉取请求。
- `labels`：标记管理。
- Markdown 里的 `#N` 在仓库页面中自动链接到对应的议题或拉取请求。

## 审计与事件

议题的日常操作（新建、评论、开关、标记、指派）记在 `issue_events`，作为议题的时间线，不进审计日志，和拉取请求的评论一样。会删除数据或改变仓库配置的操作进审计日志：`issue.deleted`、`issue.comment_deleted`（删别人的评论时）、`label.created`、`label.updated`、`label.deleted`。

## 以后

通知（议题与拉取请求的提到、指派、评论）会读 `issue_events` 与评论；拉取请求的标记可以复用 `labels`，加一张 `pull_request_labels`；里程碑、模板、锁定讨论、置顶、转移议题、反应表情都不在这一版。
