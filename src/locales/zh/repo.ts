/** Chinese for the repo area: see index.ts for the terms. */
export const repo: Record<string, string> = {
  // BranchSelect
  'Switch branches': '切换分支',
  'Find a branch...': '查找分支…',
  'Nothing to show': '没有可显示的内容',
  default: '默认',
  // CloneButton
  Code: '代码',
  Clone: '克隆',
  'Clone with': '克隆方式',
  'AI agent': 'AI Agent',
  'HTTPS clone URL': 'HTTPS 克隆地址',
  'Copy clone URL': '复制克隆地址',
  'personal access token': '个人访问令牌',
  'Anyone can clone this public repository without a token. To push, use a {token} as your password. Large files use Git LFS.':
    '任何人都可以不用令牌克隆这个公开仓库。推送时请使用{token}作为密码。大文件使用 Git LFS。',
  'Use a {token} as your password. Large files use Git LFS.':
    '使用{token}作为密码。大文件使用 Git LFS。',
  // CommitBody
  'Open the finding': '打开这条评审意见',
  Trailers: '尾注',
  'with {names}': '与 {names} 共同提交',
  // CommitList
  'Hide the rest of the message': '收起提交信息的其余部分',
  'Show the rest of the message': '展开提交信息的其余部分',
  'committed {when}': '提交于 {when}',
  'Open this commit': '打开此提交',
  'Copy full SHA': '复制完整 SHA',
  'Browse the code at {sha}': '浏览 {sha} 时的代码',
  'Browse the code at this commit': '浏览此提交时的代码',
  'Commits on {day}': '{day} 的提交',
  // DiffView
  Added: '新增',
  Deleted: '已删除',
  'Hide {path}': '收起 {path}',
  'Show {path}': '展开 {path}',
  'Binary file not shown.': '二进制文件不显示。',
  'Large diffs are not rendered by default.': '较大的差异默认不显示。',
  'File added without changes.': '新增的文件没有内容变化。',
  'Empty file or mode change only.': '空文件，或仅更改了文件模式。',
  'No changes to show': '没有可显示的更改',
  // FileList
  'Show fewer': '收起',
  'Show {n} more': '再显示 {n} 个',
  // Markdown
  "This diagram couldn't be drawn; showing its source.":
    '无法绘制此图表，显示其源码。',
  // VisibilityLabel, RepoLayout
  'Only you, collaborators, and site admins can see this':
    '只有你、协作者和站点管理员可以看到',
  'Every member can see this': '所有成员都可以看到',
  'Anyone can see this, even without an account': '任何人都可以看到，无需账户',
  'Agent instructions': 'Agent 指令',
  '{name}’s profile': '{name} 的个人资料',
  Repository: '仓库',
  // RepoBoard
  'Team · internal': '团队 · 内部',
  'AGENT.md and knowledge/': 'AGENT.md 和 knowledge/',
  'No reviewer agents yet': '还没有评审 Agent',
  'In flight': '进行中',
  'Merged, last 7 days': '最近 7 天合并',
  'Pull requests merged per day, last 7 days': '最近 7 天每天合并的拉取请求数',
  ' merged': ' 已合并',
  'Nothing merged this week': '本周没有合并',
  '{pct}% merged with no merge click': '{pct}% 无需点击合并',
  'Decide in Approvals: {repo}': '在待审批中处理：{repo}',
  'Decide in Approvals': '在待审批中处理',
  'Open {repo}': '打开 {repo}',
  Open: '打开',
  Reviews: '评审',
  'None decided yet': '还没有决定',
  'No reviews yet': '还没有评审',
  '{pct}% kept · {n} dismissed': '{pct}% 被采纳 · {n} 条被驳回',
  'Its record is not available.': '它的记录不可用。',
  'On {repos}': '在 {repos} 上',
  'Not on a repository': '不在任何仓库中',
  Learned: '已学习',
  '{n} rule': '{n} 条规则',
  '{n} rules': '{n} 条规则',
  '{n} finding raised': '{n} 条评审意见',
  '{n} findings raised': '{n} 条评审意见',
  'Saved from requests a person dismissed.': '来自人工驳回的请求。',
  'Nothing yet. Rules appear when a person dismisses a request.':
    '还没有。有人驳回请求时，规则会出现在这里。',
  'On duty': '在岗',
  Off: '离岗',
  Profile: '个人资料',
  'open pull requests': '打开的拉取请求',
  '{n} open pull request': '{n} 个打开的拉取请求',
  '{n} open pull requests': '{n} 个打开的拉取请求',
  // board.ts
  All: '全部',
  'Needs attention': '需要关注',
  'Recently updated': '最近更新',
  Name: '名称',
  'needs a person': '需要人工处理',
  'changes requested': '已请求更改',
  checking: '检查中',
  queued: '排队中',
  '{n} needs a person': '{n} 个需要人工处理',
  '{n} need a person': '{n} 个需要人工处理',
  '{n} with changes requested': '{n} 个已请求更改',
  '{n} being checked': '{n} 个检查中',
  '{n} queued to merge': '{n} 个排队合并',
  '{n} open': '{n} 个未关闭',
  'No open pull requests': '没有打开的拉取请求',
  '{n} branch': '{n} 个分支',
  '{n} branches': '{n} 个分支',
  '{n} reviewer': '{n} 位评审者',
  '{n} reviewers': '{n} 位评审者',
  // repoNav.ts
  Health: '健康度',
  'Pull requests': '拉取请求',
  Releases: '发行版',
  Actions: 'Actions',
  Insights: '洞察',
  Commits: '提交',
  'New pull request': '新建拉取请求',
  Session: '会话',
  Tags: '标签',
  'Run #{n}': '运行 #{n}',
  'Agent run': 'Agent 运行',
  // code/BlobView
  'Line {n}': '第 {n} 行',
  line: '行',
  lines: '行',
  View: '视图',
  Preview: '预览',
  Raw: '原始文件',
  'Copy raw content': '复制原始内容',
  'Binary file not shown. {link}': '二进制文件不显示。{link}',
  'View raw': '查看原始文件',
  "(Sorry about that, but we can't show files that are this big right now.) {link}":
    '（抱歉，目前无法显示这么大的文件。）{link}',
  'This file is empty.': '这个文件是空的。',
  'Stored with Git LFS': '使用 Git LFS 存储',
  Download: '下载',
  "This file is tracked with Git LFS, but its content hasn't been uploaded to this server. Push it with {command}.":
    '这个文件由 Git LFS 跟踪，但内容还没有上传到这台服务器。请用 {command} 推送。',
  'This file is stored with Git LFS. {link} to view it.':
    '这个文件使用 Git LFS 存储。{link}后查看。',
  'Download it': '下载',
  // code/CodeToolbar
  Path: '路径',
  branch: '个分支',
  branches: '个分支',
  'Search this repository (press /)': '搜索此仓库（按 /）',
  'Go to file': '转到文件',
  // code/FileTable
  'Up to the parent directory': '返回上级目录',
  'This directory is empty.': '这个目录是空的。',
  // code/LatestCommit, LoadError, MarkdownFile
  History: '历史',
  "We couldn't load {what}": '无法加载{what}',
  'Front matter': 'Front matter',
  README: 'README',
  // code/QuickSetup
  'Copy these commands': '复制这些命令',
  'Set up with an AI agent': '用 AI Agent 设置',
  'What to set up': '要设置什么',
  'Start a new project': '开始新项目',
  'Import from GitHub': '从 GitHub 导入',
  "Quick setup — if you've done this kind of thing before":
    '快速设置——如果你以前做过类似的事',
  'Authenticate with your username and a {token} as the password.':
    '使用你的用户名登录，密码填{token}。',
  '…or create a new repository on the command line':
    '…或者在命令行中创建新仓库',
  '…or push an existing repository from the command line':
    '…或者在命令行中推送已有仓库',
  '…or import a repository from GitHub on the command line':
    '…或者在命令行中从 GitHub 导入仓库',
  'Copies every branch, tag, and Git LFS file. To sync again later, run {fetch} and {lfsFetch} in the same folder, then the three push commands.':
    '会复制所有分支、标签和 Git LFS 文件。以后要再次同步，在同一目录下运行 {fetch} 和 {lfsFetch}，然后再执行那三条推送命令。',
  '…and store large files with Git LFS': '…以及用 Git LFS 存储大文件',
  'Tracked files are stored outside the repository (up to 5 GB each) and shown here with their real size. Requires {lfs}.':
    '被跟踪的文件存放在仓库之外（每个最大 5 GB），这里显示它们的真实大小。需要安装 {lfs}。',
  // code/SideCards
  About: '关于',
  Readme: '自述文件',
  '{n} branch, default {branch}': '{n} 个分支，默认 {branch}',
  '{n} branches, default {branch}': '{n} 个分支，默认 {branch}',
  'Created {when}': '创建于 {when}',
  '{name}, a reviewer agent': '{name}，一个评审 Agent',
  'Reviewer agent': '评审 Agent',
  'Changes to these files change how {name} reviews. They go through pull requests like any other change, and dismissals add rules here automatically.':
    '修改这些文件会改变 {name} 的评审方式。这些修改和其他更改一样通过拉取请求合并，驳回评审意见时也会自动在这里添加规则。',
  'Reviewer agents': '评审 Agent',
  '{name}, reviewer agent': '{name}，评审 Agent',
  'No reviewer agents yet, so pull requests wait for a person.':
    '还没有评审 Agent，所以拉取请求需要等人来处理。',
  Manage: '管理',
  'Invite a reviewer': '邀请评审者',
  // pages/CommitView
  'Changed files': '更改的文件',
  File: '文件',
  Removed: '删除',
  'this commit': '此提交',
  'Browse files': '浏览文件',
  Commit: '提交',
  '{n} parent': '{n} 个父提交',
  '{n} parents': '{n} 个父提交',
  commit: '提交',
  '{n} file changed': '{n} 个文件已更改',
  '{n} files changed': '{n} 个文件已更改',
  // pages/RepoCode
  'this page': '此页面',
  'No description provided.': '未提供描述。',
  'About this repository': '关于此仓库',
  // pages/RepoCommits
  'Every change to how this agent reviews.': '这个 Agent 评审方式的所有更改。',
  'Every change on {ref}.': '{ref} 上的所有更改。',
  'Page {n}': '第 {n} 页',
  'the commits': '提交记录',
  'Loading commits': '正在加载提交',
  'There is nothing on this page': '此页没有内容',
  'No commits yet': '还没有提交',
  'You have gone past the oldest commit.': '你已经越过最早的提交。',
  'There are no commits on {ref}.': '{ref} 上没有提交。',
  'Back to the newest': '回到最新',
  'Pages of commits': '提交分页',
  Newer: '较新',
  Older: '较早',
  // pages/Repositories
  'the reviewer agents': '评审 Agent',
  'Everything you can see on this instance: your code, and the repositories where each reviewer agent keeps its instructions.':
    '你能在这个实例上看到的一切：你的代码，以及每个评审 Agent 存放指令的仓库。',
  'No repositories yet': '还没有仓库',
  'Repositories created by anyone on this instance, and shared with you, show up here.':
    '这个实例上任何人创建的仓库，以及共享给你的仓库，都会显示在这里。',
  'Create repository': '创建仓库',
  'Could not refresh the numbers. These are from earlier.':
    '无法刷新数据，这些是之前的数据。',
  'needs you': '需要你处理',
  'need you': '需要你处理',
  'merged in 7 days': '7 天内合并',
  'merged with no merge click': '无需点击合并',
  repository: '仓库',
  repositories: '仓库',
  'Find a repository': '查找仓库',
  'Find a repository…': '查找仓库…',
  Filter: '筛选',
  Sort: '排序',
  'Reviewer instructions': '评审指令',
  'Each reviewer agent reads its instructions from its own repository. Dismissing one of its requests adds a rule here.':
    '每个评审 Agent 从自己的仓库读取指令。驳回它的请求会在这里添加一条规则。',
  'No repositories match.': '没有匹配的仓库。',
  'Try a different search or filter.': '试试其他搜索词或筛选条件。',
  'Clear search and filters': '清除搜索和筛选',
  // pages/Profile
  'About {name}': '关于 {name}',
  Team: '团队',
  Member: '成员',
  'Every member can see these repositories.': '所有成员都可以看到这些仓库。',
  'Joined {when}': '加入于 {when}',
  '{name} doesn’t have any repositories yet.': '{name} 还没有任何仓库。',
  '@{username} doesn’t have any repositories you can see yet.':
    '@{username} 还没有你可以看到的仓库。',
  'Create one and it shows up here.': '创建一个，它就会显示在这里。',
  'Private repositories only show to their owner, collaborators and site admins.':
    '私有仓库只对所有者、协作者和站点管理员可见。',
  // pages/NewRepo
  'Only you, collaborators you add, and site admins can see this repository.':
    '只有你、你添加的协作者和站点管理员可以看到这个仓库。',
  'Every member of this instance can see this repository. You and collaborators you add can push.':
    '这个实例的所有成员都可以看到这个仓库。你和添加的协作者可以推送。',
  'Anyone on the internet can see and clone this repository, without an account. You and collaborators you add can push.':
    '互联网上的任何人都可以查看和克隆这个仓库，无需账户。你和添加的协作者可以推送。',
  'Created {name}. The reviewer starts on its first pull request.':
    '已创建 {name}。评审 Agent 会在第一个拉取请求中开始工作。',
  'Created {name}. The reviewers start on its first pull request.':
    '已创建 {name}。评审 Agent 会在第一个拉取请求中开始工作。',
  "A repository holds a project's files and their full history. Moving a project from GitHub? Create it empty: the next page has the steps, including a prompt for your AI agent.":
    '仓库保存项目的文件及其完整历史。要从 GitHub 迁移项目？先创建一个空仓库：下一页会给出步骤，包括给你的 AI Agent 的提示词。',
  Owner: '所有者',
  'A site admin can create the team in Site admin':
    '站点管理员可以在站点管理员中创建团队',
  'Team repositories need a team: a site admin creates it in Site admin.':
    '团队仓库需要一个团队：由站点管理员在站点管理员中创建。',
  'Repository name': '仓库名称',
  'for example: client-portal': '例如：client-portal',
  'Your new repository will be created as {name}.':
    '你的新仓库将创建为 {name}。',
  'Great repository names are short and memorable.': '好的仓库名称简短易记。',
  Description: '描述',
  '(optional)': '（可选）',
  'A description can be at most {max} characters.': '描述最多 {max} 个字符。',
  'Who can see it': '谁可以看到',
  'Team repositories are visible to every member of {team}. You and collaborators you add can push.':
    '团队仓库对 {team} 的所有成员可见。你和添加的协作者可以推送。',
  "Could not load the reviewer agents ({error}). You can add them in the repository's settings after creating it.":
    '无法加载评审 Agent（{error}）。创建仓库后可以在仓库设置中添加。',
  "Reviewers read each pull request they are needed on. With at least one, CloudForge can merge on its own once they pass. You can change this later in the repository's settings.":
    '评审者会阅读需要它的每个拉取请求。至少有一个评审 Agent 时，它们通过后 CloudForge 可以自行合并。之后可以在仓库设置中更改。',
  'Add a README file': '添加 README 文件',
  'This is where you can write a long description for your project. Moving a project from GitHub? Leave this empty.':
    '你可以在这里为项目写一段详细的描述。要从 GitHub 迁移项目？请留空。',
  'Creating repository…': '正在创建仓库…',
  'What you get': '你会得到什么',
  'Rebase-only merges with a safety check on main':
    '仅用变基合并，并对 main 做安全检查',
  'Auto-merge when checks pass and reviewers approve':
    '检查通过且评审者批准后自动合并',
  'Actions that run your existing workflows': '运行你现有工作流的 Actions',
  'An audit log of every merge and every decision':
    '每次合并和每个决定的审计日志',
  // pages/RepoSettings
  'Private: only you, collaborators, and site admins can see this repository.':
    '私有：只有你、协作者和站点管理员可以看到这个仓库。',
  'Internal: every member of this instance can see this repository.':
    '内部：这个实例的所有成员都可以看到这个仓库。',
  'Public: anyone can see this repository and clone it, even without an account. Only you and collaborators can push.':
    '公开：任何人都可以查看和克隆这个仓库，无需账户。只有你和协作者可以推送。',
  'This repository is now private.': '此仓库现在是私有的。',
  'This repository is now internal.': '此仓库现在是内部的。',
  'This repository is now public.': '此仓库现在是公开的。',
  'Repository settings saved.': '仓库设置已保存。',
  General: '常规',
  Collaborators: '协作者',
  'Default branch': '默认分支',
  'Protected branches': '受保护分支',
  'CloudForge never rebases these branches, and they change only by merging a pull request or by a repository admin’s fast-forward push: nobody deletes or force-pushes them. The default branch is always protected.':
    'CloudForge 从不对这些分支执行变基，它们只能通过合并拉取请求或仓库管理员的快进推送来更新：任何人都不能删除或强制推送。默认分支始终受保护。',
  'Collaborators can see this private repository, push branches, and merge pull requests.':
    '协作者可以看到这个私有仓库、推送分支并合并拉取请求。',
  'Every member can read this repository. Collaborators can also push branches and merge pull requests.':
    '所有成员都可以读取这个仓库。协作者还可以推送分支并合并拉取请求。',
  Write: '编写',
  'Select a member…': '选择成员…',
  'Add collaborator': '添加协作者',
  "Reviewer agents invited to this repository. Each agent's AGENT.md says what it reviews.":
    '受邀评审此仓库的评审 Agent。每个 Agent 的 AGENT.md 说明了它评审什么。',
  'No agents invited.': '还没有邀请 Agent。',
  'Agent to invite': '要邀请的 Agent',
  'Select an agent…': '选择 Agent…',
  'Invite agent': '邀请 Agent',
  Visibility: '可见性',
  'Team repositories are always visible to every member.':
    '团队仓库始终对所有成员可见。',
  'Make private': '设为私有',
  'Make internal': '设为内部',
  'Make public': '设为公开',
  'Make {repo} public? Anyone on the internet will be able to see its code, pull requests and Actions logs, and clone it without an account.':
    '将 {repo} 设为公开？互联网上的任何人都将能看到它的代码、拉取请求和 Actions 日志，并能在没有账户的情况下克隆它。',
  'Danger Zone': '危险区域',
  'Delete this repository': '删除此仓库',
  'Once you delete a repository, there is no going back. Type {name} to confirm.':
    '仓库一旦删除就无法恢复。输入 {name} 以确认。',
  // lib/newRepo
  'A name can be at most {max} characters.': '名称最多 {max} 个字符。',
  'A name can’t be only dots.': '名称不能只有点。',
  'A name can’t end in .git.': '名称不能以 .git 结尾。',
  '{names} and {last}': '{names} 和 {last}',
  ', ': '、',
  "The repository was created, but {who} could not be added as a reviewer. {reason} You can add reviewers in the repository's settings.":
    '仓库已创建，但无法将 {who} 添加为评审者。{reason} 你可以在仓库设置中添加评审者。',
  "The repository was created, but {who} could not be added as reviewers. {reason} You can add reviewers in the repository's settings.":
    '仓库已创建，但无法将 {who} 添加为评审者。{reason} 你可以在仓库设置中添加评审者。',
};
