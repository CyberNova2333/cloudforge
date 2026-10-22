/** Chinese for the approvals area (Approvals, findings, Home): see index.ts for the terms. */
export const approvals: Record<string, string> = {
  // src/lib/approvalsInbox.ts
  '{agent} findings need a reason. Open it to decide.':
    '{agent} 的评审意见需要填写理由，请打开后再决定。',
  "{agent} findings can't be approved in bulk.":
    '{agent} 的评审意见不能批量批准。',

  // src/lib/home.ts
  '{list} and {last}': '{list} 和 {last}',
  '{n} decision': '{n} 个决定',
  '{n} decisions': '{n} 个决定',
  '{n} other item': '{n} 个其他事项',
  '{n} other items': '{n} 个其他事项',
  '{n} item': '{n} 个事项',
  '{n} items': '{n} 个事项',
  '{things} needs you.': '{things}需要你处理。',
  '{things} need you.': '{things}需要你处理。',
  'Nothing needs you.': '没有需要你处理的事项。',
  'Tests are failing on {repos}. {needs}': '{repos} 的测试未通过。{needs}',
  'busiest repository': '最活跃的仓库',
  '{n} busiest repositories': '{n} 个最活跃的仓库',
  'Nothing is broken. {needs}': '一切正常。{needs}',
  'Nothing is broken in your {checked}. {needs}': '{checked}一切正常。{needs}',
  'Nothing has merged in the last 7 days.': '过去 7 天没有合并任何改动。',
  '{n} change': '{n} 个改动',
  '{n} changes': '{n} 个改动',
  'GitOrange merged {changes} in the last 7 days, and it needed no merge click.':
    '过去 7 天 GitOrange 合并了 {changes}，无需手动点击合并。',
  'GitOrange merged {changes} in the last 7 days, and none needed a merge click.':
    '过去 7 天 GitOrange 合并了 {changes}，全部无需手动点击合并。',
  'GitOrange merged {changes} in the last 7 days; {automatic} needed no merge click.':
    '过去 7 天 GitOrange 合并了 {changes}，其中 {automatic} 个无需手动点击合并。',
  '{area} in {repo}': '{repo} 的 {area}',
  '{area}: {detail}': '{area}：{detail}',
  '{n} area in {repo} unchanged': '{repo} 中 {n} 个方面无变化',
  '{n} areas in {repo} unchanged': '{repo} 中 {n} 个方面无变化',
  'No change in {areas}': '{areas} 无变化',
  'Tests are failing on main': 'main 分支的测试未通过',
  '{n} decision for you': '{n} 个决定等你处理',
  '{n} decisions for you': '{n} 个决定等你处理',
  '{area} got worse': '{area} 变差了',
  '{n} areas got worse': '{n} 个方面变差了',
  Healthy: '健康',

  // src/components/approvals/actions.ts
  '{error} Your note was not sent.': '{error} 你的备注没有发送成功。',

  // src/pages/Approvals.tsx
  move: '移动',
  open: '打开',
  approve: '批准',
  'request changes': '请求更改',
  dismiss: '驳回',
  select: '选择',
  'approve selected': '批准所选',
  'You approved {whose} finding. #{n} can merge when nothing else holds it up.':
    '你批准了 {whose} 的评审意见。#{n} 在其他条件都满足后即可合并。',
  'Approved {agent} on #{n}': '已批准 {agent} 对 #{n} 的意见',
  'Dismissed. {agent} learns your rule when #{n} closes.':
    '已驳回。#{n} 关闭后 {agent} 会学会你的规则。',
  'Dismissed. {agent} learns your rule': '已驳回。{agent} 会学会你的规则',
  'Dismissed for #{n} only. {agent} will ask again next time.':
    '仅对 #{n} 驳回。{agent} 下次还会再问。',
  'Dismissed once': '已驳回一次',
  'Changes requested on #{n}. Its author gets {whose} finding and your note.':
    '#{n} 已请求更改。作者会收到 {whose} 的评审意见和你的备注。',
  'Changes requested on #{n}. Its author gets {whose} finding.':
    '#{n} 已请求更改。作者会收到 {whose} 的评审意见。',
  'Changes requested on #{n}': '#{n} 已请求更改',
  'You approved #{n}. It can merge when nothing else holds it up.':
    '你批准了 #{n}。在其他条件都满足后即可合并。',
  'Approved #{n}': '已批准 #{n}',
  'The review of #{n} started again.': '#{n} 的评审已重新开始。',
  'Review restarted on #{n}': '#{n} 的评审已重新开始',
  '{agent} is reviewing #{n} again.': '{agent} 正在重新评审 #{n}。',
  '{agent} is reviewing #{n} again': '{agent} 正在重新评审 #{n}',
  'Checking #{n} against the others again.':
    '正在重新检查 #{n} 与其他拉取请求的关系。',
  'Checking #{n} again': '正在重新检查 #{n}',
  you: '你',
  'Not saved: {error}': '未保存：{error}',
  'Reopened. It’s back in your list.': '已重新打开，回到你的列表里了。',
  'Approved {n} finding': '已批准 {n} 条评审意见',
  'Approved {n} findings': '已批准 {n} 条评审意见',
  '{n} approval was not saved: it is back in your list':
    '{n} 个批准未保存：已回到你的列表',
  '{n} approvals were not saved: they are back in your list':
    '{n} 个批准未保存：已回到你的列表',
  '{n} item needs you. Your reviewers raised these for a person, across every repository you can merge in.':
    '有 {n} 个事项等你处理。这些是你有权合并的所有仓库中，评审 Agent 提请人工决定的评审意见。',
  '{n} items need you. Your reviewers raised these for a person, across every repository you can merge in.':
    '有 {n} 个事项等你处理。这些是你有权合并的所有仓库中，评审 Agent 提请人工决定的评审意见。',
  'Nothing needs you. Your crew will ask when something does.':
    '没有需要你处理的事项。有需要时评审组会来找你。',
  'Approvals did not load': '待审批加载失败',
  'Nothing assigned to you in what has loaded so far.':
    '在已加载的内容中，没有指派给你的事项。',
  'Load more to look further.': '加载更多以继续查找。',
  'Nothing is assigned to you.': '没有指派给你的事项。',
  'When someone asks you to decide a finding, it shows here.':
    '有人请你决定某条评审意见时，会显示在这里。',
  'Show everything': '显示全部',
  'Your crew will ask when something does: findings agents raise for a person, failed reviews, pull requests no agent reviewed, conflicts AI couldn’t resolve, and pull requests that need a decision.':
    '有需要时评审组会来找你：评审 Agent 提请人工决定的评审意见、失败的评审、没有 Agent 评审过的拉取请求、AI 无法解决的冲突，以及需要决定的拉取请求。',
  Show: '显示',
  'Everything · {n}': '全部 · {n}',
  Everything: '全部',
  'Assigned to you · {n}': '指派给你 · {n}',
  'Assigned to you': '指派给你',
  'Keyboard shortcuts': '键盘快捷键',
  'Waiting on you': '等你处理',
  '{n} answered': '已处理 {n} 项',
  '{n} selected': '已选择 {n} 项',
  Clear: '清除',
  'Approve selected': '批准所选',
  'Load more': '加载更多',

  // src/pages/Finding.tsx
  'A removed agent': '已移除的 Agent',
  '{agent} on #{n}': '{agent} 对 #{n}',
  'Not found': '未找到',
  Finding: '评审意见',
  'Finding not found': '找不到该评审意见',
  'This finding doesn’t exist, or you can’t see its repository.':
    '这条评审意见不存在，或者你无法查看它所在的仓库。',
  'Back to Approvals': '返回待审批',
  'This finding did not load': '该评审意见加载失败',
  '{agent} asked for a change': '{agent} 请求更改',
  '{agent} is asking': '{agent} 在提问',
  '{agent} is asking about {pr} {title}. You’re answering for commit {sha}.':
    '{agent} 在询问 {pr} {title}。你的回答针对提交 {sha}。',
  '{agent} raised this on {pr} {title}, at commit {sha}.':
    '{agent} 在提交 {sha} 上对 {pr} {title} 提出了这条意见。',
  '{whose} finding.': '{whose} 的评审意见。',
  '{agent} asked for a change.': '{agent} 请求更改。',
  'The pull request’s author makes it, or you can dismiss it.':
    '拉取请求的作者会进行修改，你也可以驳回。',
  '{agent} wants a person to decide.': '{agent} 希望由人工决定。',
  'Approve it if this is intended. Otherwise request changes.':
    '如果这是预期行为，请批准；否则请求更改。',
  'No further detail: the review model didn’t answer.':
    '没有更多细节：评审模型没有返回结果。',
  '#{n} is merged, so its findings can’t be decided any more.':
    '#{n} 已合并，因此无法再决定它的评审意见。',
  '#{n} is closed, so its findings can’t be decided any more.':
    '#{n} 已关闭，因此无法再决定它的评审意见。',
  'Only people who can push to {repo} decide its findings.':
    '只有能推送到 {repo} 的人才能决定它的评审意见。',
  'About this finding': '关于这条评审意见',
  'Technical details': '技术细节',
  Files: '文件',
  '{agent} reviewed with its instructions at {sha}.':
    '{agent} 评审时使用的指令版本是 {sha}。',
  'Written by {model}.': '由 {model} 撰写。',
  'Open #{n}': '打开 #{n}',
  'About {agent}': '关于 {agent}',
  '{pr} by {author}, in {repo}{state}.':
    '{pr}，作者 {author}，位于 {repo}{state}。',
  'Raised on commit {sha}.': '提出于提交 {sha}。',
  'The branch has moved on to {sha} since.': '此后分支已前进到 {sha}。',
  'Dismissing needs a reason. It goes in the audit log with your name. {ai} never decides {agent} findings.':
    '驳回需要填写理由，理由会连同你的名字记入审计日志。{ai} 永远不会决定 {agent} 的评审意见。',
  'Approving needs a reason. It goes in the audit log with your name. {ai} never decides {agent} findings.':
    '批准需要填写理由，理由会连同你的名字记入审计日志。{ai} 永远不会决定 {agent} 的评审意见。',
  'Assigned to {who} by {by}, {when}.': '由 {by} 指派给 {who}，{when}。',
  'Assigned to {who} by {by}.': '由 {by} 指派给 {who}。',
  'Assigned to {who}, {when}.': '{when}指派给 {who}。',
  'Assigned to {who}.': '指派给 {who}。',
  'You let {ai} decide {whose} findings on your pull requests.':
    '你让 {ai} 代替你决定你拉取请求中 {whose} 的评审意见。',
  'You can change your answer while #{n} is open.':
    '#{n} 未关闭前你可以更改回答。',
  'Before you answer': '回答之前',
  '{agent} raised it.': '{agent} 提出了它。',
  'Next: {agent} on #{n}': '下一条：{agent} 对 #{n}',
  'Answer withdrawn. The finding is open again.':
    '回答已撤回，该评审意见重新打开。',
  'Approved by {by}': '由 {by} 批准',
  'Approved by {by}, {when}': '由 {by} 批准，{when}',
  'Dismissed by {by}': '由 {by} 驳回',
  'Dismissed by {by}, {when}': '由 {by} 驳回，{when}',
  'Changes requested by {by}': '{by} 请求更改',
  'Changes requested by {by}, {when}': '{by} 请求更改，{when}',
  'The pull request’s author makes the change, and {agent} reviews the new commit.':
    '拉取请求的作者会进行修改，然后 {agent} 会评审新的提交。',
  '#{n} no longer waits for this finding.': '#{n} 不再等待这条评审意见。',
  '#{n} merged, so this decision stays. Revert it from the pull request if you need to.':
    '#{n} 已合并，所以这个决定会保留。如有需要，请在拉取请求中还原。',
  '#{n} is closed, so this decision stays.':
    '#{n} 已关闭，所以这个决定会保留。',
  '{ai} answered this for {who}.': '{ai} 代替 {who} 回答了这个问题。',
  them: '对方',
  '{whose} reason.': '{whose} 的理由。',
  'Reason.': '理由。',
  'Note.': '备注。',
  'Rule:': '规则：',
  '{agent} learns this when #{n} closes, from {who}.':
    '#{n} 关闭后，{agent} 会从 {who} 学会这条规则。',
  '{agent} learns this when #{n} closes.':
    '#{n} 关闭后，{agent} 会学会这条规则。',
  'Reopening…': '正在重新打开…',
  'Change answer': '更改回答',
  '{ai} approved it for you': '{ai} 已代你批准',
  '{ai} requested changes for you': '{ai} 已代你请求更改',
  '{ai} is deciding…': '{ai} 正在决定…',
  'Let {ai} decide this one': '让 {ai} 决定这一条',
  '{ai} answers as you, and you can undo it while #{n} is open.':
    '{ai} 会以你的身份回答，#{n} 未关闭前你可以撤销。',
  '{ai} left this for you: {reason}': '{ai} 把它留给了你：{reason}',
  '{who} asked you to decide this.': '{who} 请你决定这一条。',
  'You have this one.': '这一条由你处理。',
  '{who} has this question now, asked by {by}. You can still answer it yourself.':
    '这个问题现在由 {who} 处理，由 {by} 指派。你仍然可以自己回答。',
  '{who} has this question now. You can still answer it yourself.':
    '这个问题现在由 {who} 处理。你仍然可以自己回答。',
  Yes: '是',
  'Approve it. {agent} findings need your reason, recorded in the audit log.':
    '批准它。{agent} 的评审意见需要你的理由，理由会记入审计日志。',
  'Approve it. #{n} can merge when nothing else holds it up.':
    '批准它。在其他条件都满足后 #{n} 即可合并。',
  'No, fix it': '否，需要修改',
  'Ask for a change before #{n} merges. Its author gets your note.':
    '在 #{n} 合并前请求更改。作者会收到你的备注。',
  'Ask someone': '询问他人',
  'Pass the question to someone who can push to {repo}.':
    '把这个问题交给能推送到 {repo} 的人。',
  Approved: '已批准',
  'Sent back for a change': '已退回要求修改',
  'Asked {name}': '已询问 {name}',
  'Change your answer': '更改回答',
  'Your answer': '你的回答',
  'Why is this right? {required}': '为什么这是对的？{required}',
  '(required)': '（必填）',
  '{agent} findings need a reason. It goes in the audit log with your name.':
    '{agent} 的评审意见需要填写理由，理由会连同你的名字记入审计日志。',
  'What should change? {optional}': '应该改什么？{optional}',
  '(optional)': '（可选）',
  'Who should answer?': '应该由谁回答？',
  'The people who can answer did not load.': '可以回答的人加载失败。',
  'Loading people': '正在加载人员',
  'Nobody else can push to {repo}.': '没有其他人能推送到 {repo}。',
  'Choose someone': '选择一个人',
  'Remember this for next time': '记住，下次适用',
  'Sending…': '发送中…',
  'Asking…': '询问中…',
  'Approving…': '批准中…',
  Send: '发送',
  'Ask {name}': '询问 {name}',
  Ask: '询问',
  Approve: '批准',
  'Approve instead': '改为批准',
  'Request changes': '请求更改',
  Dismiss: '驳回',
  'Approve with a reason': '填写理由后批准',
  '{agent} findings can’t be approved in bulk. Approving needs a reason.':
    '{agent} 的评审意见不能批量批准。批准需要填写理由。',
  'Dismissing a {whose} change request needs a reason.':
    '驳回 {whose} 的更改请求需要填写理由。',
  Dismissed: '已驳回',
  'Approved. Reason recorded in the audit log.': '已批准，理由已记入审计日志。',
  'Asked @{login}': '已询问 @{login}',
  'Taken back': '已收回',

  // src/components/approvals/Panels.tsx
  'Save a rule so {agent} doesn’t ask again':
    '保存一条规则，让 {agent} 不再询问',
  'The rule {agent} learns': '{agent} 要学会的规则',
  'For example: links marked public may skip sign-in.':
    '例如：标记为公开的链接可以跳过登录。',
  '{agent} learns it when #{pull} closes. Undoing your answer drops it.':
    '#{pull} 关闭后 {agent} 会学会它。撤销回答会丢弃它。',
  'The pull request’s author gets this with {agent}’s finding.':
    '拉取请求的作者会连同 {agent} 的评审意见一起收到这条备注。',
  Reason: '原因',
  'Reason {optional}': '理由 {optional}',
  'Why doesn’t this need a change?': '为什么不需要修改？',
  'Dismissing…': '驳回中…',
  'Dismiss and save a rule': '驳回并保存规则',
  'False positive': '误报',
  'The finding is wrong.': '这条评审意见是错的。',
  'Accepted risk': '接受风险',
  'The risk is real and you accept it.': '风险确实存在，你选择接受。',
  'Intended behaviour': '预期行为',
  'It works this way on purpose.': '这是有意为之的行为。',
  'Reason for approving': '批准理由',
  'Note for the audit log {optional}': '审计日志备注 {optional}',
  'Recorded in the audit log with your name and reason.':
    '会连同你的名字和理由记入审计日志。',
  'Who should decide?': '应该由谁决定？',
  'Anyone who can push to {owner}/{name} can decide its findings.':
    '任何能推送到 {owner}/{name} 的人都可以决定它的评审意见。',
  'Nobody else can push to this repository.': '没有其他人能推送到这个仓库。',
  'has it now': '现在由此人处理',
  'Unassign yourself': '取消指派给自己',
  'Take it back from {name}': '从 {name} 处收回',

  // src/components/approvals/InboxRow.tsx
  'Updated {when}': '更新于 {when}',
  Updated: '更新于',
  'Opened by {who}': '由 {who} 创建',
  'A question for a person': '需要人工回答的问题',
  '{agent} findings can’t be approved in bulk':
    '{agent} 的评审意见不能批量批准',
  'Select {agent}’s finding on #{n}': '选择 {agent} 在 #{n} 上的评审意见',
  Answer: '回答',
  'Review and decide': '查看并决定',
  'Needs your answer': '等你回答',
  'Needs a reason to approve': '批准需填写理由',
  'Changes requested by {who}': '{who} 请求了更改',
  'Assigned to {who}': '指派给 {who}',
  'Claude left this for you: {reason}': 'Claude 把它留给了你：{reason}',
  'Undo request': '撤销请求',
  '{agent}’s review failed.': '{agent} 的评审失败了。',
  'Unknown error.': '未知错误。',
  'Starting…': '正在启动…',
  'Retry {agent}’s review': '重试 {agent} 的评审',
  Review: '评审',
  'The review of #{n} failed.': '#{n} 的评审失败了。',
  'Try the review again': '重新评审',
  Conflicts: '冲突',
  'Decide on the pull request': '在拉取请求上决定',
  Stack: '堆叠',
  'Still must account for #{n}.': '仍需处理 #{n}。',
  'Nothing new since {when}.': '自 {when} 起没有新变化。',
  'View #{n}': '查看 #{n}',
  'Couldn’t check against {prs}.': '无法与 {prs} 核对。',
  'Check again': '重新检查',
  Approval: '批准',
  'No agent reviewed this commit: a person approves it.':
    '没有 Agent 评审过这个提交：需要人工批准。',
  'Approving does not override an agent’s change request: dismiss it, or wait for a fix.':
    '批准不会覆盖 Agent 的更改请求：请驳回它，或等待修改。',
  'Approve this commit': '批准此提交',
  'Review the changes': '查看更改',
  'Needs a person': '需要人工处理',
  'Undoing…': '撤销中…',
  Undo: '撤销',

  // src/pages/Home.tsx
  'We couldn’t check what needs you.': '无法检查有哪些事项在等你。',
  'what needs you': '等你处理的事项',
  'your repositories': '你的仓库',
  'the reviewer agents': '评审 Agent',
  'the health report': '健康度报告',
  'the activity': '动态',
  'Nothing is waiting on you.': '没有事项在等你。',
  'When a reviewer needs an answer from you, it shows up here first.':
    '评审者需要你回答时，会先显示在这里。',
  '{n} more item': '还有 {n} 个事项',
  '{n} more items': '还有 {n} 个事项',
  'waiting in Approvals': '在待审批中等待',
  '{n} assigned to you': '{n} 项指派给你',
  'No repositories yet': '还没有仓库',
  'Repositories created by anyone on this instance will show up here.':
    '此实例上任何人创建的仓库都会显示在这里。',
  'Create repository': '创建仓库',
  'Since last week': '自上周以来',
  'Health of your busiest repositories': '最活跃仓库的健康度',
  'Health of each repository': '各仓库的健康度',
  'All repositories': '所有仓库',
  Activity: '活动',
  'Nothing has happened yet.': '还没有任何动态。',
  'Merges, decisions and changes to these repositories appear here as they happen.':
    '这些仓库的合并、决定和更改会实时显示在这里。',
  'Recently updated': '最近更新',
  New: '新建',
  'Find a repository': '查找仓库',
  'Find a repository…': '查找仓库…',
  'Could not load your repositories.': '无法加载你的仓库。',
  "You don't have any repositories yet.": '你还没有任何仓库。',
  'No repository matches.': '没有匹配的仓库。',
  '{n} more. See all repositories.': '还有 {n} 个。查看所有仓库。',
  'Your crew': '你的评审组',
  'Could not load your crew.': '无法加载你的评审组。',
  'No reviewer agents are on your repositories yet.':
    '你的仓库上还没有评审 Agent。',
  'Bring your team': '邀请你的团队',
  'Invite members to collaborate on repositories in this instance.':
    '邀请成员在此实例的仓库中协作。',
  '{agent} is asking · {repo}': '{agent} 在提问 · {repo}',
  'Pull request #{n}': '拉取请求 #{n}',
  'by {user}': '作者 {user}',
  'Needs your reason to approve': '批准需填写你的理由',
  "Answer {agent}'s question about {repo}#{n}":
    '回答 {agent} 关于 {repo}#{n} 的问题',
  Better: '变好',
  Worse: '变差',
  Same: '持平',
  'Health unavailable': '健康度不可用',
  '{n} open': '{n} 个未关闭',
  '{n} merged in 7 days': '7 天合并 {n} 个',
  '{n}% with no merge click': '{n}% 无需手动合并',
  'No reviewer agents yet': '还没有评审 Agent',
  '{n} other reviewer has nothing to flag': '另有 {n} 位评审者没有发现问题',
  '{n} other reviewers have nothing to flag': '另有 {n} 位评审者没有发现问题',

  // src/components/approvals/ClaudePanel.tsx
  'Claude decisions': 'Claude 的决定',
  'Let {ai} decide for you': '让 {ai} 代你决定',
  '{ai} can answer findings on your pull requests for you. Each answer is recorded as “by {ai} for {me}”, and you can undo it while the pull request is open.':
    '{ai} 可以代你回答你拉取请求上的评审意见。每次回答都会记录为“{ai} 代 {me}”，拉取请求未关闭前你可以撤销。',
  'Your reviewers did not load': '你的评审 Agent 加载失败',
  'No reviewer agents yet. A site admin adds them from Agents.':
    '还没有评审 Agent。站点管理员可以在 Agent 页面添加。',
  'Reviewers {ai} answers for': '{ai} 代为回答的评审 Agent',
  '{whose} findings always come to a person: {ai} never decides them.':
    '{whose} 的评审意见始终交给人工：{ai} 永远不会决定它们。',
  'Always comes to you': '始终交给你',
  '{ai} answers': '{ai} 回答',
  'You answer': '你回答',
  '{agents} findings always come to you: {ai} never decides them, and approving one needs your reason.':
    '{agents} 的评审意见始终交给你：{ai} 永远不会决定它们，而且批准需要填写理由。',
  'Undone. It’s back in your list.': '已撤销，回到你的列表里了。',
  'What {ai} did today': '{ai} 今天做了什么',
  '{ai} hasn’t answered anything for you today.':
    '{ai} 今天还没有代你回答任何内容。',
  'by {ai} for {me}': '{ai} 代 {me}',
  'Undo: {what}': '撤销：{what}',
  'Waiting for you': '等你处理',
  '{ai} now answers {whose} findings': '{ai} 现在回答 {whose} 的评审意见',
  '{whose} findings come to you': '{whose} 的评审意见交给你',
};
