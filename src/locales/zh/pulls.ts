/** Chinese for the pulls area: see index.ts for the terms. */
export const pulls: Record<string, string> = {
  // Pulls page
  Board: '看板',
  List: '列表',
  Graph: '关系图',
  '{n} open': '{n} 个未关闭',
  '{count}, sorted by who has to act next.': '{count}，按下一步由谁处理排序。',
  'Nothing is open. Merged pull requests are below.':
    '没有开启的拉取请求。已合并的拉取请求在下方。',
  'Every pull request, open or closed. Filter them or search by number, title, person, branch or session.':
    '所有拉取请求，包括开启和已关闭的。可以筛选，或按编号、标题、人员、分支或会话搜索。',
  'How the open pull requests are slated to land, branch by branch.':
    '开启的拉取请求按目标分支展示的落地计划。',
  'Pull requests': '拉取请求',
  'New pull request': '新建拉取请求',

  // Pull request page
  'Changed files': '更改的文件',
  File: '文件',
  Removed: '删除',
  Order: '顺序',
  'The merge queue did not load': '合并队列加载失败',
  'this pull request': '此拉取请求',
  Conversation: '对话',
  Commits: '提交',
  'Files changed': '更改的文件',
  Checks: '检查',
  'Pull request': '拉取请求',
  'The commits did not load': '提交加载失败',
  'No commits to show': '没有可显示的提交',
  'Nothing on {head} is ahead of {base}.':
    '{head} 上没有领先于 {base} 的提交。',
  'The changes did not load': '更改加载失败',
  '{n} file changed': '{n} 个文件已更改',
  '{n} files changed': '{n} 个文件已更改',
  'on {commit}': '于 {commit}',

  // New pull request
  'base:': '基准：',
  'compared with': '与…比较',
  'choose…': '选择…',
  'compare:': '对比：',
  'Able to merge': '可以合并',
  'This branch can be rebased onto the base cleanly.':
    '这个分支可以干净地变基到基准分支。',
  'Can’t rebase automatically': '无法自动变基',
  'Don’t worry, you can still create the pull request.':
    '别担心，你仍然可以创建拉取请求。',
  'Compare changes': '对比更改',
  'Compare changes across branches. Pick a branch to compare against {branch}.':
    '对比各分支的更改。选择一个分支与 {branch} 对比。',
  'There are no other branches yet.': '还没有其他分支。',
  'This comparison did not load': '对比加载失败',
  'Loading the comparison': '正在加载对比',
  'There isn’t anything to compare.': '没有可对比的内容。',
  '{from} is up to date with all commits from {head}.':
    '{from} 已包含 {head} 的全部提交。',
  'Discuss and review the changes in this comparison with others.':
    '与他人讨论和评审这次对比中的更改。',
  'Create pull request': '创建拉取请求',
  'You need write access to open a pull request.':
    '你需要写入权限才能创建拉取请求。',
  'Add a title': '添加标题',
  Title: '标题',
  'Add a description': '添加描述',
  'Add your description here...': '在此添加描述...',
  'Version bump': '版本提升',
  'None (counts as patch)': '无（按修订版本计）',
  'What this change does to the next release’s version once it lands. Nothing changes until someone cuts a release.':
    '这次更改落地后对下个发行版版本号的影响。在有人发布发行版之前不会发生任何变化。',
  'Creating…': '正在创建…',
  '{n} commit': '{n} 个提交',
  '{n} commits': '{n} 个提交',
  'Back to pull requests': '返回拉取请求',
  'Open a pull request': '创建拉取请求',
  'Comparing changes': '对比更改',
  'Create a new pull request by comparing changes across two branches.':
    '对比两个分支的更改，创建新的拉取请求。',
  'Choose two branches to see what’s changed or to start a new pull request.':
    '选择两个分支，查看更改或创建新的拉取请求。',

  // Session page
  'Opened {pull}': '创建了 {pull}',
  'Merged {pull} automatically, by CloudForge':
    '由 CloudForge 自动合并了 {pull}',
  'Merged {pull} (by {actor})': '{actor} 合并了 {pull}',
  'Merged {pull}': '合并了 {pull}',
  'Closed {pull} without merging': '未合并便关闭了 {pull}',
  Timeline: '时间线',
  'The timeline did not load': '时间线加载失败',
  'Nothing has happened in this session yet': '这个会话还没有任何动态',
  'Session not found': '会话不存在',
  'No pull requests in this repository belong to it. It may have been from another repository.':
    '这个仓库里没有属于它的拉取请求。它可能来自另一个仓库。',
  Session: '会话',
  'this session': '此会话',
  'last active': '最后活跃',
  Requests: '请求',
  '{author} asked:': '{author} 的请求：',
  '{client} didn’t send the requests that started these pull requests. Their descriptions say what they do.':
    '{client} 没有发送启动这些拉取请求的请求。它们各自的描述说明了用途。',
  'Pull requests opened by hand carry no request from a coding session. Their descriptions say why.':
    '手动创建的拉取请求没有来自编码会话的请求。它们各自的描述说明了原因。',
  'About this session': '关于此会话',
  Who: '参与者',
  'Opened with {client}, which named the session {session}.':
    '使用 {client} 创建，会话名为 {session}。',
  'Opened with {client}.': '使用 {client} 创建。',
  'Opened by hand, on the web or with git push.':
    '手动创建，方式为网页或 git push。',
  'About sessions': '关于会话',
  'A session is the pull requests one app opened for one person, as the app reported them over MCP, with what the person asked for. Each pull request shows its request under “Why this change”.':
    '会话是一个应用为一个人创建的拉取请求集合，由应用通过 MCP 报告，并包含这个人的请求内容。每个拉取请求都会在“为什么有这个更改”下显示其请求。',

  // Conversation
  'commented {when}': '评论于 {when}',
  'No description provided.': '未提供描述。',
  Author: '作者',
  '{who} merged commit {commit} into {branch}':
    '{who} 将提交 {commit} 合并到 {branch}',
  'Auto-merge': '自动合并',
  'This pull request was closed': '此拉取请求已被关闭',
  '{link} to comment.': '{link}后即可评论。',
  'Add a comment': '添加评论',
  'Use Markdown to format your comment': '使用 Markdown 格式化你的评论',
  'Closing…': '正在关闭…',
  'Close with comment': '关闭并评论',
  'Close pull request': '关闭拉取请求',
  'Reopening…': '正在重新打开…',
  'Reopen pull request': '重新打开拉取请求',
  'Commenting…': '正在评论…',
  Comment: '评论',

  // Merge box
  'Resuming…': '正在恢复…',
  'Resume merging': '恢复合并',
  'Merging is paused': '合并已暂停',
  '{paused} on this repository. {by} paused it {when}. Nothing merges, by the button or automatically, until someone resumes it.':
    '此仓库状态：{paused}。{by} 在 {when}暂停了合并。在有人恢复之前，无论是手动点击还是自动流程都不会合并。',
  'Checking the branch…': '正在检查分支…',
  'The {branch} branch is gone': '{branch} 分支已不存在',
  'Starting the rebase…': '正在开始变基…',
  'Try the rebase again': '重试变基',
  'What happens next': '接下来会发生什么',
  'What it waits on': '它在等待什么',
  'Estimate: {eta}.': '预计：{eta}。',
  'Answer {name}’s question': '回答 {name} 的问题',
  'Merging is paused on this repository': '此仓库已暂停合并',
  'Approve and merge': '批准并合并',
  'Rebase and merge': '变基并合并',
  'View diff': '查看差异',
  'Confirm merge': '确认合并',
  'Review isn’t satisfied ({reasons}). Merging records your approval of this commit.':
    '评审尚未满足（{reasons}）。合并会记录你对这个提交的批准。',
  'not approved': '未批准',
  'Approval does not override an agent’s change request: dismiss it first, or the merge is refused.':
    '批准不能覆盖 Agent 的更改请求：请先驳回它，否则合并会被拒绝。',
  'CloudForge rebases this branch onto {onto} first. If the rebased commits need checks, it lands once they pass.':
    'CloudForge 会先将此分支变基到 {onto}。如果变基后的提交需要检查，则会在检查通过后落地。',
  '{base} moves to this branch’s head: its commits land as they are, keeping history linear.':
    '{base} 会移动到本分支的最新提交：其提交将按原样落地，保持历史线性。',
  'Rebasing and merging…': '正在变基并合并…',
  'Merging…': '正在合并…',
  'Confirm approve and merge': '确认批准并合并',
  'Confirm rebase and merge': '确认变基并合并',
  'Only those with write access to this repository can merge pull requests.':
    '只有对此仓库有写入权限的人才能合并拉取请求。',
  'Opened #{made} to revert #{reverted}': '已创建 #{made} 来还原 #{reverted}',
  Merged: '已合并',
  'Merged into {base} {when}': '已合并到 {base} {when}',
  'by {user}': '作者 {user}',
  'automatically, by CloudForge': '由 CloudForge 自动完成',
  'at {commit}': '于 {commit}',
  'The {branch} branch is still there.': '{branch} 分支仍然存在。',
  'It has no newer work or open pull requests that need it, so it can be deleted.':
    '它没有更新的工作或需要它的开启拉取请求，因此可以删除。',
  'The {branch} branch has been deleted.': '{branch} 分支已被删除。',
  'Deleting…': '正在删除…',
  'Delete branch': '删除分支',
  Revert: '还原',
  'Confirm revert': '确认还原',
  'Revert opens a new pull request, “Revert #{pr}: {title}”, that undoes these changes on top of {base} as it is now. Nothing changes until it is reviewed and merged like any other change.':
    '还原会新建一个拉取请求“Revert #{pr}：{title}”，在当前 {base} 之上撤销这些更改。在它像其他更改一样经过评审并合并之前，什么都不会改变。',
  'Opening…': '正在创建…',
  'Open the revert pull request': '创建还原拉取请求',
  Closed: '已关闭',
  'Closed without merging {when}.': '未合并便关闭了 {when}。',
  'Its branch {branch} is still there, so it can be reopened.':
    '它的分支 {branch} 仍然存在，因此可以重新打开。',
  "The {branch} branch is gone, so it can't be reopened.":
    '{branch} 分支已不存在，因此无法重新打开。',

  // Pull header
  'Edit title': '编辑标题',
  'for {user}': '为 {user}',
  '{who} merged {commits} into {base} from {head}':
    '{who} 将 {commits} 从 {head} 合并到 {base}',
  'wants to merge {commits} into {base} from {head}':
    '想将 {commits} 从 {head} 合并到 {base}',

  // Pull side
  Details: '详情',
  'The branch is gone, so nothing runs.':
    '分支已不存在，因此不会运行任何检查。',
  'The checks did not load.': '检查加载失败。',
  'No checks ran on this commit.': '此提交上没有运行检查。',
  'About this pull request': '关于此拉取请求',
  Branch: '分支',
  '{branch} (deleted)': '{branch}（已删除）',
  'into {base} · {commits}': '合入 {base} · {commits}',
  Compare: '对比',
  Participants: '参与者',
  'Technical details': '技术细节',
  Head: 'HEAD',
  Base: '基准',
  'State code': '状态代码',
  Summaries: '摘要',
  'Review run': '评审运行',
  'Stack run': '堆叠运行',
  'Rebase run': '变基运行',

  // Why, order, Clef and Fixer sections
  'Why this change': '为什么有这个更改',
  '{client} didn’t send the request that started this change. The description below says what it does.':
    '{client} 没有发送启动这个更改的请求。下面的描述说明了它的作用。',
  'Opened by hand, so no coding session sent a request with it. The description below says why.':
    '手动创建，因此没有编码会话发送请求。下面的描述说明了原因。',
  '{client} · session {session} · {link}': '{client} · 会话 {session} · {link}',
  '{client} · {link}': '{client} · {link}',
  'Everything in this session': '此会话中的全部内容',
  'Written by hand by {author} · {link}': '由 {author} 手动编写 · {link}',
  'Their pull requests opened by hand': '其手动创建的拉取请求',
  opened: '打开于',
  "It isn't in the merge queue yet.": '它还没有进入合并队列。',
  'Ahead of it in line': '队列中在它前面',
  'Ready to merge': '可以合并',
  'and {n} more ahead of it': '还有 {n} 个在它前面',
  'What Clef read': 'Clef 读到的内容',
  'A one-line summary of each changed file. Clef decides from these which reviewers to ask{model}{duration}.':
    '每个更改文件的一行摘要。Clef 据此决定邀请哪些评审者{model}{duration}。',
  '; {model} wrote them': '；由 {model} 撰写',
  ', and the review took {seconds} s': '，评审用时 {seconds} 秒',
  'Summarizing each changed file…': '正在汇总每个更改的文件…',
  'Show all {n} files': '显示全部 {n} 个文件',
  'Fixer rebases this branch onto {onto} when it falls behind, and combines clashing changes with AI, one commit at a time.':
    'Fixer 会在分支落后时将其变基到 {onto}，并用 AI 逐个提交地合并冲突的更改。',
  'Fixer’s attempts did not load': 'Fixer 的尝试记录加载失败',
  'Fixer is working on it now.': 'Fixer 正在处理。',
  'Fixer has no recorded attempt on this pull request.':
    'Fixer 在这个拉取请求上没有记录到尝试。',

  // Coder chip
  'By hand': '手动',
  'by hand': '手动完成',
  'Opened by hand': '手动创建',
  '{via} session {session}': '{via} 会话 {session}',

  // Comment form
  'Leave a comment': '留下评论',
  Write: '编写',
  'Nothing to preview': '没有可预览的内容',
  'Markdown is supported': '支持 Markdown',

  // Badges
  'Resolving a rebase conflict with AI…': '正在用 AI 解决变基冲突…',
  'Rebase conflict needs the author': '变基冲突需要作者处理',
  'Reviewing…': '评审中…',
  'Review required': '需要评审',
  Approved: '已批准',
  'Review failed': '评审失败',
  'Changes requested': '已请求更改',
  'Needs approval': '需要批准',
  ' · {n} flag': ' · {n} 条评审意见',
  ' · {n} flags': ' · {n} 条评审意见',

  // Timeline events
  'Stacked on {pull}': '堆叠在 {pull} 上',
  Unstacked: '已取消堆叠',
  'Unstacked from {pull}': '已从 {pull} 取消堆叠',
  'Lands after {before} so {after} can build on both':
    '在 {before} 之后落地，以便 {after} 能基于两者构建',
  'Must account for {pull}': '必须处理 {pull}',
  'Rebase onto {branch} first.': '先变基到 {branch}。',
  'Generated by CloudForge; advisory.': '由 CloudForge 生成；仅供参考。',
  'Accounted for {pull}': '已处理 {pull}',
  '{who} dismissed the dependency on {pull}': '{who} 解除了对 {pull} 的依赖',
  'A maintainer': '一位维护者',
  'A former user': '一位前用户',
  '{who} via {via} approved {commit} over {reasons}':
    '{who} 通过 {via} 批准了 {commit}，尽管存在 {reasons}',
  '{who} via {via} approved {commit}': '{who} 通过 {via} 批准了 {commit}',
  '{who} approved {commit} over {reasons}':
    '{who} 批准了 {commit}，尽管存在 {reasons}',
  '{who} approved {commit}': '{who} 批准了 {commit}',
  '{who} withdrew their approval of {commit}': '{who} 撤回了对 {commit} 的批准',
  '{who} cleared the version bump (it counts as patch)':
    '{who} 清除了版本号变更（按补丁版本计）',
  '{who} changed the version bump from {from} to {to}':
    '{who} 将版本号变更从 {from} 改为 {to}',
  '{who} set the version bump to {to}': '{who} 将版本号变更设为 {to}',

  // Pull graph
  'stacked on': '堆叠于',
  'waits on': '等待',
  'lands after': '之后落地',
  'must change for': '必须为之更改',
  'accounted for': '已处理',
  'How to read the arrows': '如何阅读箭头',
  'Arrows point at what lands first.': '箭头指向先落地的对象。',
  'Checks: {state}': '检查：{state}',
  'Pull request #{n}': '拉取请求 #{n}',
  'Landing on {branch}': '落地到 {branch}',
  'recently landed:': '最近落地：',
  '{prs} depend on each other in a circle (outlined in red), so none of them can land until one of those dependencies is dismissed.':
    '{prs} 之间形成循环依赖（用红色标出），在解除其中一项依赖之前，它们都无法落地。',
  "This graph couldn't be drawn.": '无法绘制此图。',
  Drawing: '正在绘制',
  'The graph did not load': '图加载失败',
  'Nothing is slated to land.': '没有待落地的内容。',
  'Open pull requests show up here, flowing into their target branch.':
    '开启的拉取请求会显示在这里，并流向它们的目标分支。',
  'lands after #{pr}': '在 #{pr} 之后落地',
  'must change for #{pr}': '必须为 #{pr} 更改',
  ' (accounted for)': '（已处理）',
  'stacked on #{pr}': '堆叠在 #{pr} 上',
  'waits on #{pr}': '等待 #{pr}',
  'checking #{pr}…': '正在检查 #{pr}…',
  "couldn't check against #{pr}": '无法与 #{pr} 对照检查',
  'checking…': '检查中…',
  'by @{user}': '由 @{user} 创建',
  ' (merged)': '（已合并）',

  // Pull state reasons
  'Ready for agent followup': '待 Agent 跟进',
  'Requires human review': '需要人工评审',
  'Waiting for checks': '等待检查',
  Ready: '就绪',
  'the "{check}" check failed (run #{run})': '“{check}”检查失败（运行 #{run}）',
  'the "{check}" check failed': '“{check}”检查失败',
  'a check failed (run #{run})': '有一项检查失败（运行 #{run}）',
  'a check failed': '有一项检查失败',
  'changes requested on {n} flag': '已就 {n} 条评审意见请求更改',
  'changes requested on {n} flags': '已就 {n} 条评审意见请求更改',
  'changes requested on review flags': '已就评审意见请求更改',
  'commit {sha} conflicts in {files}': '提交 {sha} 在 {files} 中冲突',
  'the rebase stopped': '变基停止',
  'must account for #{pr}, after rebasing onto {branch}':
    '变基到 {branch} 后必须处理 #{pr}',
  'must account for #{pr}': '必须处理 #{pr}',
  'CloudForge is rebasing it onto #{pr} ({branch})':
    'CloudForge 正在将其变基到 #{pr}（{branch}）',
  'depends in a circle on {prs}': '与 {prs} 形成循环依赖',
  'the "{check}" check is running': '“{check}”检查正在运行',
  'waiting for the "{check}" check': '正在等待“{check}”检查',
  'checks are running': '检查正在运行',
  'no checks have run yet': '尚未运行任何检查',
  'AI is resolving conflicts': 'AI 正在解决冲突',
  'checking against {prs}': '正在与 {prs} 对照检查',
  'checking how it relates to other open pull requests':
    '正在检查它与其他开启拉取请求的关系',
  '@{agent} is reviewing': '@{agent} 正在评审',
  'agents are reviewing': '多个 Agent 正在评审',
  '@{agent} flagged {n} finding for a person':
    '@{agent} 标记了 {n} 条需要人处理的评审意见',
  '@{agent} flagged {n} findings for a person':
    '@{agent} 标记了 {n} 条需要人处理的评审意见',
  '@{agent} requested {n} change': '@{agent} 请求了 {n} 处更改',
  '@{agent} requested {n} changes': '@{agent} 请求了 {n} 处更改',
  "@{agent}'s review failed": '@{agent} 的评审失败',
  'the review failed': '评审失败',
  'no agent reviewed it: a person approves it': '没有 Agent 评审：需要人工批准',
  'merging is paused': '合并已暂停',
  Paused: '已暂停',
  '{label}, stacked on #{pr}': '{label}，堆叠在 #{pr} 上',

  // Rebase status
  'This branch is up to date': '此分支已是最新',
  'There is nothing to merge.': '没有需要合并的内容。',
  'Up to date with {onto}': '与 {onto} 保持同步',
  'Merging moves the target branch to this branch’s head: its commits land as they are.':
    '合并会将目标分支移到本分支的最新提交：其提交将按原样落地。',
  'Behind {onto}': '落后于 {onto}',
  'CloudForge rebases it onto the latest commits; merging rebases it first if it still needs to.':
    'CloudForge 会将其变基到最新提交；合并时如果仍需要，会先进行变基。',
  'Resolving commit {sha}’s conflict with AI':
    '正在用 AI 解决提交 {sha} 的冲突',
  'Resolving a conflict with AI': '正在用 AI 解决冲突',
  'The rebase onto {onto} stopped there; an agent is resolving it and the rebase goes on.':
    '变基到 {onto} 的过程在那里停止；一个 Agent 正在解决，之后变基会继续。',
  'Commit {sha} conflicts with {onto}': '提交 {sha} 与 {onto} 冲突',
  'This branch can’t be rebased onto {onto}': '此分支无法变基到 {onto}',
  'Rebase {head} onto {onto} locally, then push.':
    '在本地将 {head} 变基到 {onto}，然后推送。',
  'its base': '其基础分支',
  'CloudForge rebased this branch onto {onto} ({from} → {to})':
    'CloudForge 将此分支变基到 {onto}（{from} → {to}）',
  ', skipping {n} commit {onto} already has': '，跳过 {onto} 已有的 {n} 个提交',
  ', skipping {n} commits {onto} already has':
    '，跳过 {onto} 已有的 {n} 个提交',
  '; AI resolved the conflicts of {n} commit': '；AI 解决了 {n} 个提交的冲突',
  '; AI resolved the conflicts of {n} commits': '；AI 解决了 {n} 个提交的冲突',

  // Queue, next step and estimates
  Open: '打开',
  'any minute now': '随时',
  'about {minutes} min': '约 {minutes} 分钟',
  'about {hours} h {minutes} min': '约 {hours} 小时 {minutes} 分钟',
  'about {hours} h': '约 {hours} 小时',
  'First in line to land on {target}.': '在 {target} 的落地队列中排第 1 位。',
  '{position} of {total} in line to land on {target}.':
    '在 {target} 的落地队列中排第 {position} 位，共 {total} 个。',
  'Merged into {base}.': '已合并到 {base}。',
  'Closed without merging.': '未合并便关闭。',
  'The {branch} branch is gone, so this can’t merge.':
    '{branch} 分支已不存在，因此无法合并。',
  'Push the branch again, or close this pull request.':
    '请重新推送该分支，或关闭此拉取请求。',
  'CloudForge doesn’t rebase this branch, and it is behind {onto}.':
    'CloudForge 不会变基此分支，而它已落后于 {onto}。',
  'It clashes with newer changes on {onto}, and Fixer couldn’t combine them.':
    '它与 {onto} 上更新的更改冲突，Fixer 无法合并它们。',
  'Someone needs to update the branch, or try the rebase again.':
    '需要有人更新分支，或重试变基。',
  'Fixer is combining it with newer changes on {onto}.':
    'Fixer 正在将它和 {onto} 上更新的更改合并。',
  'It carries on by itself once the clash is resolved.':
    '冲突解决后，它会自动继续。',
  'Checking where it stands.': '正在检查它的状态。',
  'Ready. CloudForge is merging it now.': '就绪。CloudForge 正在合并。',
  'Ready to merge. Auto-merge is off, so it waits for someone to merge it.':
    '可以合并。自动合并已关闭，因此会等待有人来合并。',
  'Ready to merge.': '可以合并。',
  'Ready, but merging is paused. Someone needs to resume merging before this can land.':
    '已就绪，但合并已暂停。需要有人恢复合并后才能落地。',
  'Merging is paused, and it is still waiting on other things.':
    '合并已暂停，而且它还在等待其他事项。',
  'Waiting. {reason}.': '等待中。{reason}。',
  'Waiting.': '等待中。',
  '{agent} asks{assignee}: {question}': '{agent} 问{assignee}：{question}',
  '{reason}.': '{reason}。',
  'Needs a person before it can merge.': '需要人工处理才能合并。',
  'Waiting for {coder} to make changes.': '等待 {coder} 进行更改。',
};
