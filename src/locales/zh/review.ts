/** Chinese for the review area (reviewers, auto-merge, pull request lists and boards): see index.ts for the terms. */
export const review: Record<string, string> = {
  // AutoMergeReview
  ' Your note was not sent.': ' 你的备注未发送。',
  'Merging automatically…': '正在自动合并…',
  'Auto-merge is off for this pull request': '此拉取请求已关闭自动合并',
  "Won't merge automatically:": '不会自动合并：',
  '; ': '；',
  'Merges automatically once ready.': '就绪后将自动合并。',
  'Waiting on: {reasons}': '等待：{reasons}',
  'Review the flags': '查看评审意见',
  'Turn off auto-merge': '关闭自动合并',
  'Turn on auto-merge': '开启自动合并',
  'a former user': '已注销用户',
  you: '你',
  'Change requested': '已请求更改',
  '{agent} is guarded: its findings are never approved in bulk, by one key or by AI, and approving one needs a reason.':
    '{agent} 受保护：其评审意见从不批量批准，也不能用一次按键或 AI 批准；批准其中一条需要填写理由。',
  'Needs a reason': '需要理由',
  'Asked {name}': '已询问 {name}',
  'Open this finding on its own page': '在独立页面打开此评审意见',
  Open: '打开',
  '{agent} asks:': '{agent} 提问：',
  Files: '文件',
  'Looking into this…': '正在核查…',
  "No further detail: the review model didn't answer.":
    '没有更多细节：评审模型没有返回结果。',
  'Changes requested by {name}': '{name} 请求了更改',
  'Dismissed by {name}': '由 {name} 驳回',
  'Approved by {name}': '由 {name} 批准',
  'Reason:': '理由：',
  'Rule for {agent}:': '{agent} 的规则：',
  'Request changes': '请求更改',
  'Dismiss with a reason…': '驳回并填写理由…',
  'Approve with a reason…': '批准并填写理由…',
  Dismiss: '驳回',
  Approve: '批准',
  'Not approved': '未批准',

  // PullBoard
  '+{n} more': '另有 {n} 项',
  ': {list}': '：{list}',
  'opened {when}': '打开于 {when}',
  '{n} comment': '{n} 条评论',
  '{n} comments': '{n} 条评论',
  'Merged {when} automatically': '{when} 自动合并',
  'Merged {when} by {name}': '{when} 由 {name} 合并',
  'Merged {when}': '{when} 已合并',
  'Merged recently': '最近合并',
  'Latest {n}': '最近 {n} 个',
  'Merged pull requests did not load.': '已合并的拉取请求未能加载。',
  'See all {n} merged': '查看全部 {n} 个已合并项',
  'Nothing has merged yet.': '还没有合并任何内容。',
  'Resuming…': '正在恢复…',
  'Pausing…': '正在暂停…',
  'Resume merging': '恢复合并',
  'Pause merging': '暂停合并',
  'Pull requests did not load': '拉取请求未能加载',
  'Merging is paused by {name}, {when}. Nothing lands until it is resumed.':
    '{name} 于 {when} 暂停了合并。恢复前不会有任何内容合入。',
  'Merging is paused. Nothing lands until it is resumed.':
    '合并已暂停。恢复前不会有任何内容合入。',
  'Blockers and estimates did not load, so cards say only what each pull request reports.':
    '阻塞项和预估未能加载，因此卡片只显示每个拉取请求自身上报的信息。',
  'No open pull requests': '没有打开的拉取请求',
  'When a coding agent or a person opens one, it shows up here with who is reviewing it and when it should land.':
    '编码 Agent 或人打开拉取请求后，会显示在这里，并标明由谁评审、预计何时合入。',
  'New pull request': '新建拉取请求',
  None: '无',

  // PullList
  'All open': '全部打开',
  Closed: '已关闭',
  'Needs you': '需要你处理',
  'Being fixed': '修复中',
  'Checking or paused': '检查中或已暂停',
  Queued: '排队中',
  "There aren't any open pull requests.": '没有打开的拉取请求。',
  "There aren't any closed pull requests.": '没有已关闭的拉取请求。',
  'No pull requests need a person right now.':
    '目前没有需要人工处理的拉取请求。',
  'No pull requests are being fixed right now.': '目前没有正在修复的拉取请求。',
  'No pull requests are being checked or paused right now.':
    '目前没有正在检查或已暂停的拉取请求。',
  'No pull requests are queued to merge right now.':
    '目前没有排队等待合并的拉取请求。',
  'opened {when} by {author}': '由 {author} 打开于 {when}',
  'by {author} was merged {when} automatically':
    '由 {author} 发起，{when} 自动合并',
  'by {author} was merged {when}': '由 {author} 发起，{when} 已合并',
  'by {author} was closed {when}': '由 {author} 发起，{when} 已关闭',
  'No pull requests match “{q}”': '没有匹配“{q}”的拉取请求',
  'Try a number, a title, a branch, a person or a session such as Claude·s4.':
    '试试编号、标题、分支、人员，或者像 Claude·s4 这样的会话。',
  'Coding agents and people open pull requests here. {link} to start one by hand.':
    '编码 Agent 和人在这里打开拉取请求。{link} 即可手动发起一个。',
  'Create a pull request': '创建拉取请求',
  Previous: '上一页',
  Next: '下一页',
  'Page {page} of {pages} · {total} pull requests':
    '第 {page} 页，共 {pages} 页 · {total} 个拉取请求',
  'Pull request state': '拉取请求状态',
  'Filter by state': '按状态筛选',
  'Search pull requests': '搜索拉取请求',
  'Pull requests': '拉取请求',

  // ReviewChip
  'Reviewing…': '评审中…',
  'Review required': '需要评审',
  Approved: '已批准',
  'Review failed': '评审失败',
  'Changes requested': '已请求更改',
  'Needs approval': '需要批准',
  '{n} flag': '{n} 条评审意见',
  '{n} flags': '{n} 条评审意见',

  // ReviewerAvatars
  Reviewers: '评审者',
  '{name}: {state}': '{name}：{state}',

  // ReviewersBox
  'Not needed': '不需要',
  'Needs a person': '需要人工处理',
  "{name}'s review": '{name} 的评审',
  'Removed from this repository: its review no longer counts':
    '已从该仓库移除：其评审不再计入',
  removed: '已移除',
  Agent: 'Agent',
  'The review failed.': '评审失败。',
  'Starting…': '正在启动…',
  "Retry {name}'s review": '重试 {name} 的评审',
  'of {sha}': '针对 {sha}',
  "Clef's probability that this change concerns the agent":
    'Clef 判断此更改与该 Agent 相关的概率',
  'requested at Clef {pct}': 'Clef 请求概率 {pct}',
  "The agent's commit this review used": '本次评审使用的 Agent 提交',
  "{name}'s review of an earlier commit": '{name} 对较早提交的评审',
  '{verb} on {sha}, an earlier commit': '{verb}，对应较早的提交 {sha}',
  '{n} finding on this earlier commit': '此较早提交上有 {n} 条评审意见',
  '{n} findings on this earlier commit': '此较早提交上有 {n} 条评审意见',
  'approved this commit': '批准了此提交',
  'No person has approved this commit.': '还没有人批准此提交。',
  "Approving does not override an agent's change request: dismiss it, or push a fix.":
    '批准不会覆盖 Agent 的更改请求：请驳回该请求，或推送修复。',
  'Withdraw approval': '撤回批准',
  'Approve this commit': '批准此提交',
  'Approving stands over findings from unguarded agents and failed or unfinished reviews. Guarded findings still need a decision with a reason; an agent’s change request needs a new commit or a Dismiss.':
    '批准会覆盖未受保护 Agent 的评审意见，以及失败或未完成的评审。受保护的评审意见仍需填写理由后再决定；Agent 的更改请求需要新的提交或驳回。',
  'Approve this commit. Guarded findings still need a decision with a reason; an agent’s change request needs a new commit or a Dismiss.':
    '批准此提交。受保护的评审意见仍需填写理由后再决定；Agent 的更改请求需要新的提交或驳回。',
  'Summarizing each changed file…': '正在汇总每个更改的文件…',
  'Asking which agents this concerns…': '正在确定此事涉及哪些 Agent…',
  Reviews: '评审',
  'The review failed: {message}': '评审失败：{message}',
  'unknown error': '未知错误',
  'Try the review again': '重新评审',
  'No agent reviews this repository, so a person approves each commit. {link}':
    '没有 Agent 评审此仓库，因此每个提交由人批准。{link}',
  'Invite agents': '邀请 Agent',
  'No invited agent was needed for this commit, so a person approves it.':
    '没有受邀 Agent 需要评审此提交，因此由人批准。',
  'Requested at Clef {pct}': 'Clef 请求概率 {pct}',
  "Go to {name}'s review (requested at Clef {pct})":
    '转到 {name} 的评审（Clef 请求概率 {pct}）',
  "Go to {name}'s review": '转到 {name} 的评审',
  'Not needed ({n})': '不需要（{n}）',
  'Clef: {pct}': 'Clef：{pct}',
  'Approved by': '批准者',
  'via {via}': '通过 {via}',

  // StackSidebar
  ', ': '、',
  Stack: '堆叠',
  'Checking against other open pull requests…':
    '正在与其他打开的拉取请求进行比对…',
  'Independent of other open pull requests.': '与其他打开的拉取请求无关。',
  'Checking against {list}…': '正在与 {list} 比对…',
  'Lands after {after} so {pr} can build on both:':
    '在 {after} 之后合入，以便 {pr} 能同时基于两者构建：',
  'another pull request': '另一个拉取请求',
  'Builds on {pr}:': '基于 {pr}：',
  Unstack: '解除堆叠',
  'Retarget to the land target and stop building on it':
    '改为以合入目标为基础，不再基于它构建',
  'Built on by {list}': '被 {list} 基于构建',
  'Waits on {pr}:': '等待 {pr}：',
  'Stop waiting on it': '不再等待它',
  'accounted for': '已处理',
  'Must change for {pr} (landed):': '必须为 {pr} 修改（已合入）：',
  'Must change for {pr}:': '必须为 {pr} 修改：',
  'Depends in a circle on {list}; a person decides the order.':
    '与 {list} 存在循环依赖；由人决定顺序。',
  "Couldn't check against {list}.": '无法与 {list} 进行比对。',

  // VersionPanel
  Release: '发行版',
  'Version bump': '版本提升',
  'None (counts as patch)': '无（按修订版本计）',
  'Version bump: {bump}': '版本提升：{bump}',
  'Released in {version}': '发布于 {version}',
  'Not released yet.': '尚未发布。',
  'Unreleased changes': '未发布的更改',

  // src/lib/pullBoard.ts
  Checking: '检查中',
  Paused: '已暂停',
  'under a minute': '不到一分钟',
  'about {m} min': '约 {m} 分钟',
  'about {h} h {m} min': '约 {h} 小时 {m} 分钟',
  'about {h} h': '约 {h} 小时',
  '{eta} once it is unblocked': '解除阻塞后 {eta}',
  'Lands in {eta}': '{eta} 后合入',
  'Nothing is holding it back. It lands next.': '没有任何阻碍，下一个合入。',
  'Nothing is holding it back.': '没有任何阻碍。',
  'Its state can’t be read right now.': '暂时无法读取其状态。',
  'Stacked on #{n}': '堆叠于 #{n}',
  'Waits on #{n}': '等待 #{n}',

  // src/lib/reviewTimeline.ts
  'approved these changes': '批准了这些更改',
  'requested changes': '请求了更改',
  'flagged {n} finding for a person': '标记了 {n} 条评审意见，需要人工处理',
  'flagged {n} findings for a person': '标记了 {n} 条评审意见，需要人工处理',
  'flagged {n} finding, approved': '标记了 {n} 条评审意见，已批准',
  'flagged {n} findings, all approved': '标记了 {n} 条评审意见，全部已批准',
  'is reviewing…': '正在评审…',
  'couldn’t finish its review': '未能完成评审',
  'flagged {n} finding': '标记了 {n} 条评审意见',
  'flagged {n} findings': '标记了 {n} 条评审意见',

  // src/lib/releaseDraft.ts
  'First release.': '首个发行版。',

  // src/lib/versionBump.ts
  major: '主版本',
  minor: '次版本',
  patch: '修订版本',
  Major: '主版本',
  Minor: '次版本',
  Patch: '修订版本',
  'patch (default)': '修订版本（默认）',

  // RepoReleases
  Releases: '发行版',
  Tags: '标签',
  'Each pull request says what it does to the version. Cut a release when what has landed on {branch} is ready; the releases below are the changelog.':
    '每个拉取请求都会说明它对版本的影响。当 {branch} 上已合入的内容准备好后，就可以发布发行版；下面的发行版就是变更日志。',
  Unreleased: '未发布',
  'since {version}': '自 {version} 起',
  'The unreleased changes did not load': '未发布的更改未能加载',
  'Nothing to release': '没有可发布的内容',
  'Nothing has landed on {branch} since {version}.':
    '自 {version} 以来，{branch} 上没有任何内容合入。',
  'No pull request has landed on {branch} yet.':
    '{branch} 上还没有拉取请求合入。',
  '#{number} by {author}': '#{number}，由 {author}',
  '{n} pull request has': '{n} 个拉取请求已',
  '{n} pull requests have': '{n} 个拉取请求已',
  'landed. The first release is a starting line: it records them without listing them, and the changelog starts from there.':
    '合入。首个发行版是一个起点：它只记录这些拉取请求而不逐一列出，变更日志从那里开始。',
  'Cut first release': '发布首个发行版',
  'Cut {version}': '发布 {version}',
  'Cut release': '发布发行版',
  'Next: {version}': '下一个：{version}',
  'The default branch has no commits': '默认分支还没有任何提交',
  Version: '版本',
  'A version is vX.Y.Z, like v0.1.0.': '版本格式为 vX.Y.Z，例如 v0.1.0。',
  'The version to start from. Later ones follow from each pull request’s bump.':
    '起始版本。之后的版本按每个拉取请求的版本提升推算。',
  'Tags the head of {branch}. A version you type must be higher than {version}.':
    '为 {branch} 的当前头提交打标签。手动输入的版本必须高于 {version}。',
  Notes: '说明',
  'What this release changes': '本次发行版有哪些更改',
  'Cutting…': '正在发布…',
  '{n} release': '{n} 个发行版',
  '{n} releases': '{n} 个发行版',
  'The releases did not load': '发行版未能加载',
  'No releases yet': '还没有发行版',
  'Once a release is cut, its notes appear here, newest first.':
    '发布发行版后，其说明会显示在这里，最新的在前。',
  'by {name}': '由 {name}',
  'No notes.': '没有说明。',

  // ReleaseView
  'this release': '此发行版',
  'Cut {when} by {name} at {sha}': '由 {name} 于 {when} 发布，对应提交 {sha}',
  'Cut {when} at {sha}': '于 {when} 发布，对应提交 {sha}',
  'Back to releases': '返回发行版列表',
  Title: '标题',

  // RepoTags
  'Every tag in the repository. A tag pushed with git is listed too, but only a release CloudForge cut counts as a version.':
    '仓库中的每个标签。用 git 推送的标签也会列出，但只有 CloudForge 发布的发行版才算作版本。',
  'The tags did not load': '标签未能加载',
  'No tags yet': '还没有标签',
  'Cutting a release tags the default branch; tags pushed with git show up here too.':
    '发布发行版会为默认分支打标签；用 git 推送的标签也会显示在这里。',
  Tag: '标签',
  Commit: '提交',
  'Pushed with git': '用 git 推送',
};
