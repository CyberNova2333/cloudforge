/**
 * Chinese for messages the server sends (API errors shown in the UI), by their exact English text, and
 * `zhPatterns` for messages with names or numbers in them ($1, $2… are the pattern's groups).
 */
export const errors: Record<string, string> = {
  // ── Auth, middleware and generic HTTP ─────────────────────────────────────
  Unauthorized: '请先登录',
  Forbidden: '没有权限',
  'Not Found': '未找到',
  'Not found': '未找到',
  'Internal Server Error': '服务器内部错误',
  'Invalid cursor': '游标无效',
  'cursor: invalid': 'cursor 无效',
  'Expected a WebSocket upgrade': '需要 WebSocket 升级请求',
  'Live updates are not set up on this server': '此服务器未配置实时更新',
  'Unknown setting': '未知设置',
  'Invalid value': '值无效',
  'month must be YYYY-MM': 'month 必须是 YYYY-MM 格式',
  'A link was sent less than a minute ago. Try again shortly.':
    '不到一分钟前已发送过链接，请稍后再试。',
  'Synced less than 5 minutes ago. Try again shortly.':
    '不到 5 分钟前已同步过，请稍后再试。',
  'Cloudflare analytics are not set up: add the CF_ANALYTICS_TOKEN secret (Account Analytics: Read).':
    '未配置 Cloudflare 分析：请添加 CF_ANALYTICS_TOKEN 密钥（Account Analytics: Read）。',

  // ── Sign-in and account hooks (better-auth) ───────────────────────────────
  'Agents can’t sign in.': 'Agent 无法登录。',
  'Agents can’t have a password.': 'Agent 不能设置密码。',
  'An agent’s role can’t be changed.': '不能更改 Agent 的角色。',
  'An agent’s username and email can’t be changed.':
    '不能更改 Agent 的用户名和邮箱。',
  'Username is not available.': '用户名不可用。',
  'Delete agents from Site admin → Agents.':
    '请在 站点管理员 → Agent 中删除 Agent。',

  // ── First-run setup ───────────────────────────────────────────────────────
  'Setup has already been completed': '初始设置已经完成',
  'The setup code is missing or wrong.': '设置码缺失或不正确。',
  'Username is reserved.': '该用户名为保留名称。',
  'Username may only contain alphanumeric characters or single hyphens, and cannot begin or end with a hyphen.':
    '用户名只能包含字母、数字和单个连字符，且不能以连字符开头或结尾。',

  // ── Repositories and branches ─────────────────────────────────────────────
  'Repository name is invalid': '仓库名称无效',
  'Name already exists in this namespace': '此命名空间下已存在同名仓库',
  'Team repositories are always visible to every member':
    '团队仓库始终对全体成员可见',
  'Branch not found': '分支不存在',
  'You must be an admin of this repository': '你必须是此仓库的管理员',
  'Cannot delete the default branch': '无法删除默认分支',
  'Ref not found': '引用不存在',
  'Path not found': '路径不存在',
  'LFS object not found': 'LFS 对象不存在',
  'You do not have push access': '你没有推送权限',
  'You do not have push access to this repository': '你没有此仓库的推送权限',
  'At most 50 protected branch patterns': '最多 50 个受保护分支模式',
  'A protected branch pattern is empty': '受保护分支模式不能为空',
  "Git LFS isn't configured on this server. An administrator needs to set the R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY secrets.":
    '此服务器未配置 Git LFS。管理员需要设置 R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY 密钥。',

  // ── Pull requests, reviews and merging ────────────────────────────────────
  'This pull request is no longer open': '此拉取请求已不再处于开启状态',
  'This pull request is already merged': '此拉取请求已经合并',
  'This pull request is not stacked': '此拉取请求不在堆叠中',
  'No dependency on that pull request': '该拉取请求没有依赖关系',
  'The head branch no longer exists': '头分支已不存在',
  'The branch has new commits since you looked. Try again.':
    '在你查看之后，分支有了新提交。请重试。',
  'Only a merged pull request can be reverted.':
    '只有已合并的拉取请求才能还原。',
  'GitOrange can’t find the commits this pull request landed, so it can’t revert it.':
    'GitOrange 找不到此拉取请求落地的提交，因此无法还原它。',
  'GitOrange can’t read the commits it would revert.':
    'GitOrange 无法读取它要还原的提交。',
  'Only open pull requests are reviewed': '只有开启的拉取请求才会评审',
  'You do not have permission to merge': '你没有合并权限',
  'You do not have permission to approve': '你没有批准权限',
  'You do not have permission to request changes': '你没有请求更改的权限',
  'You do not have permission to do that': '你没有执行此操作的权限',
  'AI is not configured on this instance': '此实例未配置 AI',
  'The retry could not be started; try again later': '无法开始重试，请稍后再试',
  'Nothing to retry: the review of this commit has not failed':
    '没有可重试的内容：此提交的评审并未失败',
  'No agents review this repository': '没有 Agent 评审此仓库',
  'Only a failed review can be retried': '只能重试失败的评审',
  'This review is of an older commit; the current one is reviewed afresh':
    '此评审针对的是较旧的提交，当前提交会重新评审',
  'This agent is no longer invited to the repository':
    '此 Agent 已不再被邀请至此仓库',
  'This review was already retried': '此评审已经重试过',
  'The review could not be started. Try again.': '无法开始评审，请重试。',
  'The review could not be started; try again later':
    '无法开始评审，请稍后再试',
  'Someone already decided this finding': '已经有人决定了这条评审意见',
  'This flag is already approved': '此评审意见已经批准',
  'Reviewer agents raise findings: ask a person to decide them.':
    '评审 Agent 会提出评审意见：请让人来决定。',
  'Nobody has decided this finding yet': '还没有人决定这条评审意见',
  'The decision changed since you looked': '在你查看之后，决定已经改变',
  "You can't decide findings in this repository":
    '你不能决定此仓库中的评审意见',
  "This finding is an agent's change request: dismiss it instead":
    '这条评审意见是 Agent 的更改请求：请改为驳回',
  "This finding needs a person's approval, not a dismissal":
    '这条评审意见需要人工批准，而不是驳回',
  "This is the agent's own change request: push the change, or dismiss it":
    '这是 Agent 自己的更改请求：请推送更改，或驳回它',
  'This finding is already approved: undo the approval to teach the agent with it':
    '这条评审意见已经批准：要借此教会 Agent，请先撤销批准',
  "GitOrange AI decides findings that need a person. This is the agent's own change request, for the pull request's agent.":
    'GitOrange AI 决定需要人工处理的评审意见。这条是 Agent 自己的更改请求，应由拉取请求的 Agent 处理。',
  'The pull request has new commits since you looked. Review them, then decide again.':
    '在你查看之后，拉取请求有了新提交。请重新评审后再决定。',
  'The pull request has new commits since you looked. Review them, then approve again.':
    '在你查看之后，拉取请求有了新提交。请重新评审后再批准。',
  'The pull request has new commits since you looked. Review them, then merge again.':
    '在你查看之后，拉取请求有了新提交。请重新评审后再合并。',
  'Pull request is not open': '拉取请求未处于开启状态',
  'Nothing to merge': '没有可合并的内容',
  'Nothing to merge: the base already has every change on this branch.':
    '没有可合并的内容：基准分支已包含此分支上的所有更改。',
  'The target branch no longer exists': '目标分支已不存在',
  'Base branch was modified. Review and try the merge again.':
    '基准分支已被修改。请复查后重新合并。',
  'Merge failed': '合并失败',
  'Couldn’t check how it relates to other open pull requests (the stack tree). Try again.':
    '无法检查它与其他开启的拉取请求的关系（堆叠树）。请重试。',
  'Merging is paused on this repository. Anyone with push access can resume it.':
    '此仓库的合并已暂停。任何有推送权限的人都可以恢复。',
  'Superseded by newer commits.': '已被更新的提交取代。',
  'Too many files to review automatically — a person must approve.':
    '文件太多，无法自动评审——需要人工批准。',
  'The review stopped unexpectedly. Try again.': '评审意外停止，请重试。',
  "GitOrange AI isn't set up on this server, so this finding waits for you.":
    '此服务器未配置 GitOrange AI，因此这条评审意见会等你处理。',
  "GitOrange AI couldn't decide this one, so it waits for you.":
    'GitOrange AI 无法决定这一条，因此它等你处理。',
  "The Pi review's workspace was gone before it answered. Try again.":
    'Pi 评审的工作区在它作答之前就不见了，请重试。',
  'Stopped: a newer commit replaced this one.':
    '已停止：有更新的提交取代了此提交。',
  'Stopped: the review was cancelled or retried.': '已停止：评审被取消或重试。',
  'Stopped: the pull request was closed. Retry reviews it again.':
    '已停止：拉取请求已关闭。重试会重新评审。',
  "engine: pi isn't set up on this server (no AGENT_REVIEWER binding), so this review ran as a single pass.":
    '此服务器未配置 engine: pi（缺少 AGENT_REVIEWER 绑定），因此本次评审以单遍方式运行。',
  "Pi isn't set up any more; Retry the review.": 'Pi 已不再配置；请重试评审。',
  'The edit deleted AGENT.md.': '此次编辑删除了 AGENT.md。',
  'Only open pull requests are rebased.': '只有开启的拉取请求才能变基。',
  'The pull request has no branch to rebase.': '此拉取请求没有可变基的分支。',
  'A retry is already in progress.': '已有重试正在进行。',
  'A rebase run is still finishing; try again in a moment.':
    '还有变基运行正在结束，请稍后再试。',
  'GitOrange does not rebase pull requests on this instance: rebase it locally.':
    '此实例的 GitOrange 不对拉取请求做变基：请在本地变基。',
  'The commits could not be read.': '无法读取提交。',
  "The agent's repository was deleted.": 'Agent 的仓库已被删除。',
  "The agent's repository could not be read.": 'Agent 的仓库无法读取。',
  'The lesson stopped unexpectedly.': '学习意外停止。',
  'The learner was stopped before the lesson started.':
    '学习在课程开始前就已被停止。',
  "Learning runs on Pi, which isn't set up on this server (no AGENT_REVIEWER binding).":
    '学习依赖 Pi，而此服务器未配置 Pi（缺少 AGENT_REVIEWER 绑定）。',
  "The lesson's workspace was gone before it answered.":
    '课程的工作区在它作答之前就不见了。',
  'Did not finish': '未完成',

  // ── Actions ───────────────────────────────────────────────────────────────
  'You do not have permission to cancel runs': '你没有取消运行的权限',
  'You do not have permission to re-run runs': '你没有重新运行工作流的权限',
  'This run has already finished': '此运行已经结束',
  'Actions is not set up on this server': '此服务器未配置 Actions',

  // ── Emails and invitations ────────────────────────────────────────────────
  'That is already your primary email': '这已经是你的主邮箱',
  'That email belongs to another member': '该邮箱属于另一位成员',
  'You have already added that email': '你已经添加过该邮箱',
  'That email has a pending invitation to this instance':
    '该邮箱已收到此实例的邀请，尚未接受',
  'That email is already verified': '该邮箱已经验证',
  'This verification link is not valid': '此验证链接无效',
  'This verification link has expired. Send a new one.':
    '此验证链接已过期，请重新发送。',
  'A user with that email already exists': '该邮箱对应的用户已存在',
  "That email is one of a member's commit emails": '该邮箱是某位成员的提交邮箱',
  'This invitation is invalid or has expired': '此邀请无效或已过期',
  'Could not create account': '无法创建账户',
  'Could not create user': '无法创建用户',

  // ── Agents and AGENT.md ───────────────────────────────────────────────────
  'Agent not found': 'Agent 不存在',
  'Give the agent a handle and a display name, or pick a preset.':
    '请填写 Agent 的用户名和显示名称，或选择一个预设。',
  'Use letters, numbers, and single hyphens (no leading or trailing hyphen); some names are reserved.':
    '请使用字母、数字和单个连字符（不能以连字符开头或结尾）；部分名称是保留的。',
  'Give the agent a display name.': '请填写 Agent 的显示名称。',
  'The display name must be one line, without control characters.':
    '显示名称必须为一行，且不能包含控制字符。',
  'must be between 0 and 1 (exclusive)': '必须介于 0 和 1 之间（不含两端）',
  'must be a colour like "#2a78d6"': '必须是类似 "#2a78d6" 的颜色',
  'must be pass or pi': '必须是 pass 或 pi',
  'must be true or false': '必须为 true 或 false',
  'must be owner/name': '必须为 owner/name 格式',
  'cursor: is not a cursor this log handed out':
    'cursor：这不是此日志发出的游标',
  'AGENT.md is missing.': 'AGENT.md 缺失。',
  'AGENT.md could not be read.': 'AGENT.md 无法读取。',
  'AGENT.md is larger than 64 KB.': 'AGENT.md 超过 64 KB。',
  'AGENT.md must start with YAML frontmatter between --- lines.':
    'AGENT.md 必须以 --- 行之间的 YAML frontmatter 开头。',
  'AGENT.md has no instructions below the frontmatter.':
    'AGENT.md 的 frontmatter 下方没有指令。',
  "The edit changed AGENT.md's front matter; only the instructions below it may change.":
    '此次编辑改动了 AGENT.md 的 front matter；只有其下方的指令可以更改。',

  // ── Releases ──────────────────────────────────────────────────────────────
  'A pull request is landing; try again in a moment':
    '有一个拉取请求正在落地，请稍后再试',
  'A version looks like v1.2.3 (no pre-release suffix)':
    '版本号应形如 v1.2.3（不带预发布后缀）',
  'The first release needs a version, for example v0.1.0':
    '第一个发行版需要指定版本，例如 v0.1.0',
  'Nothing to release': '没有可发布的内容',
  'Another release was cut at the same time; reload and try again':
    '同一时间有另一个发行版被创建，请重新加载后再试',
  'First release.': '首个发行版。',

  // ── Auto-merge, checks and the merge queue ────────────────────────────────
  'No checks have run for this commit yet': '此提交尚未运行任何检查',
  'Checks failed': '检查失败',
  'Checks are running': '检查正在运行',
  'Tests failed': '测试失败',
  'Tests are running': '测试正在运行',
  'Waiting for tests to start': '正在等待测试开始',
  'Merging is paused': '合并已暂停',
  'Needs a person to approve it': '需要人工批准',
  'Being reviewed': '正在评审',
  'Agents are reviewing the changes': 'Agent 正在评审更改',
  'No agent reviewed it: a person needs to approve it':
    '没有 Agent 评审：需要人工批准',
  'The review failed': '评审失败',
  'GitOrange is fixing a clash': 'GitOrange 正在修复冲突',
  'Checking how it relates to other pull requests':
    '正在检查它与其他拉取请求的关系',
  'Clashes with newer changes': '与更新的更改冲突',
  'Its branch no longer exists': '其分支已不存在',
  'The branch it merges into no longer exists': '它合并到的分支已不存在',
  'Its state can’t be read right now': '暂时无法读取其状态',
  'Tests on main': 'main 上的测试',
  'Sends each change to the helpers and tests it needs.':
    '把每个更改发送给所需的评审 Agent 和测试。',
  'Untangles changes that collide so they can go in.':
    '理清相互冲突的更改，让它们能够合入。',
  'changes routed': '已路由的更改',
  'per review': '每次评审',
  attempts: '尝试次数',
  combined: '合并成功',
  'merged anyway': '仍然合并',

  // ── Site admin → Settings (worker/src/lib/settings.ts) ────────────────────
  General: '常规',
  'AI models': 'AI 模型',
  Reviews: '评审',
  Actions: 'Actions',
  'Instance name': '实例名称',
  'Shown in page titles, sign-in and setup pages, invitation emails, the git sign-in prompt, and as the MCP server name.':
    '显示在页面标题、登录与初始设置页面、邀请邮件、git 登录提示中，也用作 MCP 服务器名称。',
  'Invitation sender': '邀请邮件发件人',
  'The address invitation emails come from. Its domain must be onboarded to Cloudflare Email Sending.':
    '邀请邮件的发件地址。其域名必须已接入 Cloudflare Email Sending。',
  'Conflict resolution model': '冲突解决模型',
  'Workers AI model the conflict-resolution agent uses. It must support tool calling.':
    '冲突解决 Agent 使用的 Workers AI 模型，必须支持工具调用。',
  'Review summary model': '评审摘要模型',
  'Writes the one-line summary of each changed file in a review.':
    '为评审中每个更改的文件撰写一行摘要。',
  'Agent review model': 'Agent 评审模型',
  "Runs each reviewer agent's single-pass review (engine: pass, and engine: pi where Pi isn't set up) and writes its findings' explanations and diagrams.":
    '运行每个评审 Agent 的单遍评审（engine: pass，以及在未配置 Pi 时的 engine: pi），并撰写评审意见的说明和图表。',
  'Agent deep review model': 'Agent 深度评审模型',
  'Runs reviewer agents with `engine: pi`, which read the repository with tools. It must support tool calling. Follows the agent review model until set here.':
    '运行使用 `engine: pi`、可用工具读取仓库的评审 Agent。必须支持工具调用。在另行设置之前，跟随 Agent 评审模型。',
  'Deep review time limit (minutes)': '深度评审时限（分钟）',
  'How long an engine: pi review may run before it fails (Retry runs it again). From 5 to 60 minutes.':
    'engine: pi 评审在失败前最多可运行多久（重试会再次运行）。5 到 60 分钟。',
  'Deep review tool calls': '深度评审工具调用次数',
  'File reads and searches one engine: pi review may make; past them it is told to answer with what it has. From 5 to 500.':
    '一次 engine: pi 评审可进行的文件读取和搜索次数；超过后会被要求用现有信息作答。5 到 500。',
  'Deep review model calls': '深度评审模型调用次数',
  'Model calls one engine: pi review may make before it is stopped and fails. From 5 to 500.':
    '一次 engine: pi 评审在被停止并判定失败前可进行的模型调用次数。5 到 500。',
  'Deep review input tokens': '深度评审输入令牌数',
  'Input tokens, summed over the whole review, before an engine: pi review is stopped and fails. From 100,000 to 50,000,000.':
    '整个评审累计的输入令牌数达到此值后，engine: pi 评审会被停止并判定失败。100,000 到 50,000,000。',
  'Learning time limit (minutes)': '学习时限（分钟）',
  'How long one lesson (an agent learning from change requests people dismissed) may run before it fails; the daily sweep tries a failed lesson once more. From 2 to 30 minutes.':
    '一次学习（Agent 从人们驳回的更改请求中学习）在失败前最多可运行多久；每日清理会再尝试一次失败的学习。2 到 30 分钟。',
  'Learning tool calls': '学习工具调用次数',
  'File reads, searches and edits one lesson may make; past them it is told to finish. From 5 to 200.':
    '一次学习可进行的文件读取、搜索和编辑次数；超过后会被要求收尾。5 到 200。',
  'Learning model calls': '学习模型调用次数',
  'Model calls one lesson may make before it is stopped and fails. From 5 to 200.':
    '一次学习在被停止并判定失败前可进行的模型调用次数。5 到 200。',
  'Learning input tokens': '学习输入令牌数',
  'Input tokens, summed over the whole lesson, before it is stopped and fails. From 100,000 to 10,000,000.':
    '整个学习累计的输入令牌数达到此值后会被停止并判定失败。100,000 到 10,000,000。',
  'Keep Actions runs for': 'Actions 运行记录保留时长',
  'Finished workflow runs, with their jobs, steps, and logs, are deleted this many days after they finish, and agent runs this many days after they start. Empty keeps them forever.':
    '已结束的工作流运行（含其作业、步骤和日志）在结束这么多天后删除；Agent 运行从开始算起这么多天后删除。留空则永久保留。',
  'Jobs running at once': '同时运行的作业数',
  'The most Actions jobs that run at the same time across the instance, each in its own container. Jobs past the limit wait in a queue, first come first served, and the run page shows how many are ahead.':
    '整个实例中同时运行的 Actions 作业上限，每个作业在各自的容器中运行。超出上限的作业会按先来后到在队列中等待，运行页面会显示前面还有多少。',

  // ── Site admin → Setup (worker/src/lib/setup-checks.ts) ───────────────────
  Secrets: '密钥',
  Bindings: '绑定',
  Connectivity: '连通性',
  Variables: '变量',
  'Usage & cost': '用量与费用',
  'D1 database': 'D1 数据库',
  'Email sending': '邮件发送',
  'Git LFS pre-signed URLs': 'Git LFS 预签名 URL',
  'Actions cache pre-signed URLs': 'Actions 缓存预签名 URL',
  'Usage resource variables': '用量资源变量',
  'Durable Object namespace IDs': 'Durable Object 命名空间 ID',
  'Last usage sync': '上次用量同步',
  'Missing. Sessions and the MCP OAuth signing keys are protected with a built-in default secret anyone can read, or sign-in fails outright.':
    '未设置。会话和 MCP OAuth 签名密钥使用任何人都能读取的内置默认密钥保护，或者登录直接失败。',
  'Still the placeholder from .dev.vars.example, so anyone can forge sessions. Replace it with a random value.':
    '仍是 .dev.vars.example 中的占位值，任何人都能伪造会话。请换成随机值。',
  'Both set. Git LFS and the Actions cache can sign R2 URLs.':
    '均已设置。Git LFS 和 Actions 缓存可以签发 R2 URL。',
  'Set: the first admin needs the code from `yarn gitorange install`.':
    '已设置：首位管理员需要 `yarn gitorange install` 打印的代码。',
  'Not set: the first account created becomes the site admin.':
    '未设置：创建的第一个账户将成为站点管理员。',
  'Bound.': '已绑定。',
  'Not bound. Nothing works: users, repositories, and pull requests live in D1.':
    '未绑定。什么都用不了：用户、仓库和拉取请求都存放在 D1 中。',
  'Not bound. No git storage: repositories cannot be created, browsed, cloned, or pushed.':
    '未绑定。没有 git 存储：无法创建、浏览、克隆或推送仓库。',
  'Not bound. The web app is not served.': '未绑定。不提供网页应用。',
  'Not bound. Git LFS cannot store files, and deleting a repository cannot clean up its LFS objects.':
    '未绑定。Git LFS 无法存储文件，删除仓库时也无法清理其 LFS 对象。',
  'Not bound. Invitation and verification emails are not sent; you have to share invite links by hand.':
    '未绑定。不会发送邀请和验证邮件，你需要手动分享邀请链接。',
  'Not bound. Actions is off: pushes never queue workflow runs.':
    '未绑定。Actions 已关闭：推送不会触发工作流运行。',
  'Not bound. Actions jobs have no container to run in.':
    '未绑定。Actions 作业没有可运行的容器。',
  'Not bound. Actions jobs start as soon as they are ready, with no limit on how many run at once (Site admin → Settings → Jobs running at once is ignored).':
    '未绑定。Actions 作业一就绪就会开始，同时运行的数量不受限制（站点管理员 → 设置 → 同时运行的作业数 会被忽略）。',
  'Not bound. Actions step logs cannot be stored or shown.':
    '未绑定。无法存储或显示 Actions 步骤日志。',
  'Not bound. Actions jobs run without a cache (actions/cache, setup-node cache:).':
    '未绑定。Actions 作业在没有缓存的情况下运行（actions/cache、setup-node cache:）。',
  'Not bound. No AI conflict resolution and no agent reviews: conflicts must be resolved locally and a person approves every pull request.':
    '未绑定。没有 AI 冲突解决，也没有 Agent 评审：冲突必须在本地解决，每个拉取请求都需要人工批准。',
  'Not bound. AI conflict resolution has no workspace to run in.':
    '未绑定。AI 冲突解决没有可运行的工作区。',
  'Not bound. engine: pi agents review as a single pass (one model call), as engine: pass agents do, and their reviews say so.':
    '未绑定。engine: pi 的 Agent 会像 engine: pass 的 Agent 一样只做单遍评审（一次模型调用），其评审中会注明这一点。',
  'Not bound. Workers AI is unavailable: AI conflict resolution and agent reviews fail.':
    '未绑定。Workers AI 不可用：AI 冲突解决和 Agent 评审会失败。',
  "Not bound. Pages don't update live; people refresh to see new pushes, runs, and approvals.":
    '未绑定。页面不会实时更新；人们需要刷新才能看到新的推送、运行和批准。',
  'From the repository root, set the secret on the deployed worker (it prompts for the value, and rolls out a new version):':
    '在仓库根目录为已部署的 worker 设置密钥（会提示输入值，并发布新版本）：',
  'Changing it signs everyone out and disconnects every MCP app; they reconnect by signing in again.':
    '更改后所有人都会被退出登录，每个 MCP 应用都会断开；重新登录即可重连。',
  'Create an R2 API token: R2 → Manage API tokens → Create API token, permission Object Read & Write, scoped to the LFS and Actions cache buckets. Copy its Access Key ID and Secret Access Key (S3 credentials).':
    '创建 R2 API 令牌：R2 → Manage API tokens → Create API token，权限选 Object Read & Write，范围限定为 LFS 和 Actions 缓存存储桶。复制其 Access Key ID 和 Secret Access Key（S3 凭据）。',
  'Add it to the env.dev block of wrangler.jsonc (named environments do not inherit bindings), then restart yarn dev:':
    '将其添加到 wrangler.jsonc 的 env.dev 块中（命名环境不会继承绑定），然后重启 yarn dev：',
  'Add it to wrangler.jsonc (copy it from wrangler.jsonc.example; keep the top level and env.dev in sync):':
    '将其添加到 wrangler.jsonc（可从 wrangler.jsonc.example 复制；顶层和 env.dev 要保持一致）：',
  'Then redeploy:': '然后重新部署：',
  'Check that database_id in wrangler.jsonc names a database in this account:':
    '检查 wrangler.jsonc 中的 database_id 是否指向此账户中的数据库：',
  "Check that the binding's bucket_name exists in this account (create it if not):":
    '检查绑定中的 bucket_name 是否存在于此账户（不存在就创建）：',
  'If the token is wrong, create a new one (Object Read & Write on the LFS and Actions cache buckets) and set both secrets again:':
    '如果令牌不对，请新建一个（对 LFS 和 Actions 缓存存储桶具有 Object Read & Write 权限），并重新设置这两个密钥：',
  'Check that the account has Artifacts access and that the namespace in wrangler.jsonc exists:':
    '检查账户是否有 Artifacts 访问权限，以及 wrangler.jsonc 中的命名空间是否存在：',
  'Set FROM_EMAIL in wrangler.jsonc vars to an address on a domain onboarded to Cloudflare Email Sending, then redeploy:':
    '在 wrangler.jsonc 的 vars 中把 FROM_EMAIL 设为已接入 Cloudflare Email Sending 的域名下的地址，然后重新部署：',
  'Set it in the env.dev vars of wrangler.jsonc, then restart yarn dev:':
    '在 wrangler.jsonc 的 env.dev vars 中设置，然后重启 yarn dev：',
  'Set it in the top-level vars of wrangler.jsonc, then redeploy (yarn deploy):':
    '在 wrangler.jsonc 的顶层 vars 中设置，然后重新部署（yarn deploy）：',
  'If both addresses should work, open the instance at BASE_URL instead.':
    '如果两个地址都应可用，请改用 BASE_URL 打开实例。',
  'Your account id is the hex string in the dashboard URL, or:':
    '你的账户 ID 是控制台 URL 中的十六进制字符串，也可以通过以下命令获取：',
  'Find your account id:': '查找你的账户 ID：',
  '"default" is created on first use. To use another name, create that gateway first:':
    '“default”会在首次使用时创建。要使用其他名称，请先创建该网关：',
  'Logs, token counts, and cost are in the dashboard:':
    '日志、令牌数和费用都在控制台中查看：',
  'Create an account API token with only Account Analytics: Read, scoped to this account.':
    '创建仅含 Account Analytics: Read 权限、范围限定为此账户的账户 API 令牌。',
  'For JobRunner, the container application lists it too (durable_objects.namespace_id):':
    '对于 JobRunner，容器应用也会列出它（durable_objects.namespace_id）：',
  'Or open Site admin → Usage & cost and click Sync now.':
    '或者打开 站点管理员 → 用量与费用 并点击 立即同步。',
  'Most are fixed by the variables above. A "not configured" metric is skipped on purpose; an API error usually means the token lacks Account Analytics: Read or a field name changed.':
    '大多可通过上面的变量修复。“not configured”的指标是有意跳过的；API 错误通常意味着令牌缺少 Account Analytics: Read 权限，或某个字段名变了。',
  'Reachable; every migration is applied.': '可访问；所有迁移都已应用。',
  'Reachable.': '可访问。',
  'The R2 token, R2_ACCOUNT_ID, and bucket name work together.':
    'R2 令牌、R2_ACCOUNT_ID 和存储桶名称配合正常。',
  'Reachable; repositories can be listed.': '可访问；可以列出仓库。',
  'FROM_EMAIL is not set, so invitations and verification emails are not sent.':
    '未设置 FROM_EMAIL，因此不会发送邀请和验证邮件。',
  'Not set. Sign-in, invite links, and MCP OAuth use it.':
    '未设置。登录、邀请链接和 MCP OAuth 都会用到它。',
  'Not set; the instance is called "GitOrange" in titles, emails, and the MCP server id.':
    '未设置；标题、邮件和 MCP 服务器 ID 中实例名为“GitOrange”。',
  'Not set. Git LFS and the Actions cache cannot build R2 URLs.':
    '未设置。Git LFS 和 Actions 缓存无法构建 R2 URL。',
  "Doesn't look like a Cloudflare account id (32 hex characters).":
    '看起来不像是 Cloudflare 账户 ID（32 位十六进制字符）。',
  'Set.': '已设置。',
  'Not set. Git LFS cannot build upload and download URLs.':
    '未设置。Git LFS 无法构建上传和下载 URL。',
  'Not set. Actions jobs run without a cache.':
    '未设置。Actions 作业将在没有缓存的情况下运行。',
  'Off: Workers AI is called directly, so requests, tokens, and cost are not logged anywhere you can see them.':
    '已关闭：直接调用 Workers AI，因此请求、令牌和费用不会记录在任何你能看到的地方。',
  'Not set, so calls go through the "default" gateway. Set it explicitly so the choice is visible in wrangler.jsonc.':
    '未设置，因此调用会经过“default”网关。建议显式设置，以便在 wrangler.jsonc 中看到这项选择。',
  'Not checked: the AI binding is missing (see Bindings).':
    '未检查：缺少 AI 绑定（见 绑定）。',
  'AI calls are logged in the "default" gateway (created on first use). Checking for free can\'t prove the gateway accepts requests: use Test to send one tiny request.':
    'AI 调用会记录在“default”网关中（首次使用时创建）。免费检查无法证明网关会接受请求：请使用 测试 发送一个极小的请求。',
  'Set. Usage & cost pulls Cloudflare analytics daily.':
    '已设置。用量与费用 会每天拉取 Cloudflare 分析数据。',
  "Not set. Usage & cost shows only GitOrange's own records (Actions runners, AI tokens, emails), not Cloudflare's analytics.":
    '未设置。用量与费用 只显示 GitOrange 自己的记录（Actions 运行器、AI 令牌、邮件），不含 Cloudflare 的分析数据。',
  'Worker, D1, buckets, Artifacts namespace, and Workflows are all named.':
    'Worker、D1、存储桶、Artifacts 命名空间和 Workflows 都已指定。',
  'JobRunner, MergeResolver, AgentReviewer, and LiveHub are all set.':
    'JobRunner、MergeResolver、AgentReviewer 和 LiveHub 都已设置。',
  'Never synced yet. The daily sync runs at 02:30 UTC.':
    '尚未同步过。每日同步在 UTC 02:30 运行。',
  'The AI binding is missing.': '缺少 AI 绑定。',
  'Workers AI answered. AI_GATEWAY is off, so nothing was logged.':
    'Workers AI 已作答。AI_GATEWAY 已关闭，因此没有记录。',
  Accounts: '账户',
  'Default language': '默认语言',
  'The interface language for visitors and for members who have not picked one in their settings. Follow the browser shows Chinese when the browser prefers it, else English.':
    '访客以及未在个人设置中选择语言的成员所看到的界面语言。“跟随浏览器”会在浏览器偏好中文时显示中文，否则显示英文。',
  'Follow the browser': '跟随浏览器',
  'Self sign-up': '自助注册',
  'Anyone who can reach this instance can create a member account from the sign-in page, without an invitation. Off: people join by invitation only.':
    '任何能访问这个实例的人都可以在登录页自行创建成员账户，无需邀请。关闭时只能通过邀请加入。',
  'Sign-up email domains': '允许注册的邮箱域名',
  'Only email addresses at these domains can sign up, separated by commas (for example: example.com, example.org). Empty allows any address.':
    '只有这些域名的邮箱地址可以注册，多个域名用逗号分隔（例如：example.com, example.org）。留空则允许任何地址。',
  'Use domains like example.com, separated by commas':
    '请填写类似 example.com 的域名，多个用逗号分隔',
  'Verify email on sign-up': '注册时验证邮箱',
  'Accounts made by self sign-up must open the link emailed to them before they can sign in. It needs outbound email (Email Sending); invited members and the first admin are never asked.':
    '自助注册的账户必须先打开发到邮箱的链接才能登录。需要已配置发信（Email Sending）；被邀请的成员和第一个管理员不受影响。',
  'Set up the instance first.': '请先完成实例的初始设置。',
  'Self sign-up is off. Ask an administrator for an invitation.':
    '未开放自助注册，请向管理员索取邀请。',
  'Accounts with this email domain can’t sign up here.':
    '这个邮箱域名不允许在此注册。',
  'Choose a username.': '请填写用户名。',
  'Confirm your email first: open the link we sent you, then sign in.':
    '请先确认邮箱：打开我们发给你的链接后再登录。',
  'No sign-up is waiting for this email to be confirmed.':
    '没有等待确认这个邮箱的注册。',
};

/**
 * Messages with names or numbers in them: the first pattern that matches (anchored, most specific first)
 * supplies the Chinese, with $1… replaced by its groups.
 */
export const zhPatterns: [RegExp, string][] = [
  // Client-side request failures.
  [/^Request failed: (\d+)$/, '请求失败：$1'],

  // Site admin → Setup: titles.
  [/^R2 bucket (.+)$/, 'R2 存储桶 $1'],
  [/^Gateway "(.+)"$/, '网关“$1”'],

  // Site admin → Setup: secrets and bindings.
  [
    /^Set, but only (\d+) characters\. Use at least (\d+) random characters so sessions can't be forged\.$/,
    '已设置，但只有 $1 个字符。请使用至少 $2 个随机字符，以免会话被伪造。',
  ],
  [/^Set \((\d+)\+ characters\)\.$/, '已设置（$1 个及以上字符）。'],
  [
    /^Missing (.+)\. Git LFS answers "not configured" \(pushes with LFS files fail\) and Actions jobs run without a cache\. Everything else works\.$/,
    '缺少 $1。Git LFS 会返回“未配置”（推送含 LFS 文件的内容会失败），Actions 作业则没有缓存。其他功能正常。',
  ],
  [
    /^Add (.+) to \.dev\.vars in the repository root \(see \.dev\.vars\.example\), then restart yarn dev\.$/,
    '将 $1 添加到仓库根目录的 .dev.vars（参见 .dev.vars.example），然后重启 yarn dev。',
  ],
  [/^Every binding is described in (.+)\.$/, '每个绑定都在 $1 中有说明。'],

  // Site admin → Setup: connectivity probes.
  [/^A test query failed \((.+)\)\.$/, '测试查询失败（$1）。'],
  [
    /^Reachable, but (\d+) migrations? not applied \((.+)\)\. Features that use the new tables fail\.$/,
    '可访问，但有 $1 个迁移尚未应用（$2）。使用新表的功能会失败。',
  ],
  [/^Bound, but a read failed \((.+)\)\.$/, '已绑定，但读取失败（$1）。'],
  [
    /^Listing repositories failed \((.+)\)\. Git reads, pushes, and new repositories will fail\.$/,
    '列出仓库失败（$1）。git 读取、推送和新建仓库都会失败。',
  ],
  [
    /^A signed test read failed\. (.+) doesn't name a bucket in R2_ACCOUNT_ID's account\.$/,
    '签名测试读取失败。$1 不是 R2_ACCOUNT_ID 所属账户中的存储桶。',
  ],
  [
    /^A signed test read failed\. R2 does not recognise R2_ACCESS_KEY_ID \(the token was deleted, or it belongs to another account\)\.$/,
    '签名测试读取失败。R2 无法识别 R2_ACCESS_KEY_ID（令牌已被删除，或属于另一个账户）。',
  ],
  [
    /^A signed test read failed\. R2_SECRET_ACCESS_KEY doesn't match R2_ACCESS_KEY_ID\.$/,
    '签名测试读取失败。R2_SECRET_ACCESS_KEY 与 R2_ACCESS_KEY_ID 不匹配。',
  ],
  [
    /^A signed test read failed\. The R2 token can't read this bucket: give it Object Read & Write on (.+)\.$/,
    '签名测试读取失败。R2 令牌无法读取此存储桶：请授予它对 $1 的 Object Read & Write 权限。',
  ],
  [
    /^A signed test read failed\. R2 answered (.+)\.$/,
    '签名测试读取失败。R2 返回 $1。',
  ],
  [
    /^FROM_EMAIL \("(.+)"\) isn't an email address, so invitations can't be sent\.$/,
    'FROM_EMAIL（“$1”）不是邮箱地址，因此无法发送邀请。',
  ],
  [
    /^Sending from (.+)\. Its domain must be onboarded to Email Sending; this check sends nothing, so invite someone to confirm delivery\.$/,
    '发件地址为 $1。其域名必须已接入 Email Sending；此检查不会发送邮件，请邀请某人以确认送达。',
  ],
  [
    /^Check R2_ACCOUNT_ID and (.+) in wrangler\.jsonc against the bucket's real name and account:$/,
    '对照存储桶的真实名称和账户，检查 wrangler.jsonc 中的 R2_ACCOUNT_ID 和 $1：',
  ],

  // Site admin → Setup: variables.
  [
    /^"(.+)" isn't a URL\. Sign-in, invite links, and MCP OAuth use it\.$/,
    '“$1”不是 URL。登录、邀请链接和 MCP OAuth 都会用到它。',
  ],
  [
    /^Is (.+), but you're using (.+)\. Sign-in from this address is rejected as an untrusted origin, and invite links and MCP OAuth point elsewhere\.$/,
    '是 $1，但你正在使用 $2。从此地址登录会被视为不可信来源而拒绝，邀请链接和 MCP OAuth 也会指向别处。',
  ],
  [/^(.+), matching this page\.$/, '$1，与当前页面一致。'],
  [
    /^"(.+)"\. It must equal the (.+) binding's bucket_name\.$/,
    '“$1”。必须等于 $2 绑定的 bucket_name。',
  ],
  [
    /^"(.+)" isn't a Workers AI model id \(@cf\/<author>\/<model>\); AI conflict resolution fails\.$/,
    '“$1”不是 Workers AI 模型 ID（@cf/<author>/<model>）；AI 冲突解决会失败。',
  ],
  [
    /^"(.+)" isn't a Workers AI model id \(@cf\/<author>\/<model>\); review file summaries fails\.$/,
    '“$1”不是 Workers AI 模型 ID（@cf/<author>/<model>）；评审文件摘要会失败。',
  ],
  [
    /^"(.+)" isn't a Workers AI model id \(@cf\/<author>\/<model>\); agent reviews and stacking fails\.$/,
    '“$1”不是 Workers AI 模型 ID（@cf/<author>/<model>）；Agent 评审和堆叠会失败。',
  ],
  [/^Not set; AI conflict resolution fails\.$/, '未设置；AI 冲突解决会失败。'],
  [/^Not set; review file summaries fails\.$/, '未设置；评审文件摘要会失败。'],
  [
    /^Not set; agent reviews and stacking fails\.$/,
    '未设置；Agent 评审和堆叠会失败。',
  ],

  // Site admin → Setup: AI Gateway, usage and the Test button.
  [
    /^The AI binding could not reach AI Gateway \((.+)\)\.$/,
    'AI 绑定无法连接 AI Gateway（$1）。',
  ],
  [
    /^Create the gateway "(.+)" in the dashboard \(or set AI_GATEWAY to "default", which is created on first use\), then redeploy\.$/,
    '在控制台中创建网关“$1”（或将 AI_GATEWAY 设为“default”，它会在首次使用时创建），然后重新部署。',
  ],
  [
    /^AI calls are logged in "(.+)"\. Checking for free can't prove that gateway exists: use Test to send one tiny request\.$/,
    'AI 调用记录在“$1”中。免费检查无法证明该网关存在：请使用 测试 发送一个极小的请求。',
  ],
  [
    /^Open Durable Objects in the dashboard and select (.+)\. The namespace ID is the 32-character hex string in the page URL \(…\/durable-objects\/view\/<ID>\/overview\)\.$/,
    '在控制台中打开 Durable Objects 并选择 $1。命名空间 ID 是页面 URL 中的 32 位十六进制字符串（…/durable-objects/view/<ID>/overview）。',
  ],
  [
    /^Not set, so these aren't measured: (.+)\.$/,
    '未设置，因此以下项目不会被计量：$1。',
  ],
  [
    /^(.+), so Durable Object usage for (.+) isn't measured\.$/,
    '$1，因此 $2 的 Durable Object 用量不会被计量。',
  ],
  [/^(\S+): (\d+) metrics? unavailable\. (.*)$/, '$1：$2 个指标不可用。$3'],
  [/^(.+): every metric synced\.$/, '$1：所有指标已同步。'],
  [/^The request failed: (.+)$/, '请求失败：$1'],
  [
    /^Workers AI answered through "(.+)", and the request was logged\.$/,
    'Workers AI 通过“$1”作答，且请求已被记录。',
  ],
  [
    /^Workers AI answered, but no gateway log id came back; check that "(.+)" exists and has logging on\.$/,
    'Workers AI 已作答，但没有返回网关日志 ID；请检查“$1”是否存在并启用了日志记录。',
  ],

  // Repositories, branches, releases.
  [/^At most (\d+) protected branch patterns$/, '最多 $1 个受保护分支模式'],
  [
    /^Protected branch patterns are at most (\d+) characters$/,
    '受保护分支模式最多 $1 个字符',
  ],
  [
    /^Protected branch pattern "(.+)" contains whitespace$/,
    '受保护分支模式“$1”包含空白字符',
  ],
  [/^(.+) is a protected branch\.$/, '$1 是受保护分支。'],
  [
    /^Open pull request #(\d+) uses (.+)\.$/,
    '开启的拉取请求 #$1 正在使用 $2。',
  ],
  [/^(.+) has no commits$/, '$1 没有提交'],
  [
    /^(.+) moved to (.+); check what it adds and cut again$/,
    '$1 已移动到 $2；请检查新增内容后重新创建发行版',
  ],
  [
    /^(v\d+\.\d+\.\d+) is not after the latest release, (.+)$/,
    '$1 不在最新发行版 $2 之后',
  ],
  [/^Tag (.+) already exists; type a version$/, '标签 $1 已存在；请输入版本号'],

  // Pull requests, findings and reviews.
  [
    /^There isn't anything to compare\. (.+) is up to date with (.+)\.$/,
    '没有可比较的内容。$1 已与 $2 同步。',
  ],
  [
    /^A pull request already exists for (.+) \(#(\d+)\)\.$/,
    '已存在针对 $1 的拉取请求（#$2）。',
  ],
  [/^You can add at most (\d+) emails$/, '最多只能添加 $1 个邮箱'],
  [/^Username (.+) is not available\.$/, '用户名 $1 不可用。'],
  [/"(.+)" is already a username or team name$/, '“$1”已被用作用户名或团队名'],
  [
    /^A repository can invite at most (\d+) agents\. Remove one first\.$/,
    '一个仓库最多只能邀请 $1 个 Agent。请先移除一个。',
  ],
  [
    /^The display name can be at most (\d+) characters\.$/,
    '显示名称最多 $1 个字符。',
  ],
  [
    /^(.+) no longer reviews this repository: decide this finding yourself$/,
    '$1 已不再评审此仓库：请自行决定这条评审意见',
  ],
  [
    /^(.+)'s findings always come to a person: GitOrange AI never decides them\.$/,
    '$1 的评审意见始终由人决定：GitOrange AI 从不决定它们。',
  ],
  [
    /^Approving (.+)'s findings needs a reason\. It goes in the audit log with your name\.$/,
    '批准 $1 的评审意见需要填写理由。理由会和你的名字一起记入审计日志。',
  ],
  [/^The note can be at most (\d+) characters$/, '备注最多 $1 个字符'],
  [/^The reason can be at most (\d+) characters$/, '理由最多 $1 个字符'],
  [
    /^What you teach can be at most (\d+) characters$/,
    '你教给 Agent 的内容最多 $1 个字符',
  ],
  [/^No reviewer agent is called (.+)$/, '没有名为 $1 的评审 Agent'],
  [/^No one is called @(.+)$/, '没有名为 @$1 的人'],
  [
    /^@(.+) can't push to (.+), so they can't decide its findings\.$/,
    '@$1 无法推送到 $2，因此不能决定其评审意见。',
  ],
  [
    /^(.+) no longer exists; nothing was committed\.$/,
    '$1 已不存在；未提交任何内容。',
  ],
  [
    /^(.+) changed on (.+) while the agent was learning; nothing was committed\.$/,
    '$1 在 Agent 学习期间于 $2 上发生了变化；未提交任何内容。',
  ],
  [/^must be one of (.+)$/, '必须是以下之一：$1'],
  [
    /^AGENT\.md frontmatter is not valid YAML: (.+)$/,
    'AGENT.md 的 frontmatter 不是有效的 YAML：$1',
  ],
  [/^AGENT\.md could not be read: (.+)$/, 'AGENT.md 无法读取：$1'],
  [/^The pull request could not be read: (.+)$/, '无法读取拉取请求：$1'],
  [/^The learning model failed: (.+)$/, '学习模型失败：$1'],

  // Rebases and landings.
  [
    /^Nothing to retry: AI is resolving commit (.+) now\.$/,
    '没有可重试的内容：AI 正在解决提交 $1。',
  ],
  [
    /^Nothing to retry: AI is resolving a conflict now\.$/,
    '没有可重试的内容：AI 正在解决冲突。',
  ],
  [
    /^Nothing to retry: GitOrange is rebasing it onto (.+)\.$/,
    '没有可重试的内容：GitOrange 正在将它变基到 $1。',
  ],
  [
    /^Nothing to retry: it is up to date with (.+)\.$/,
    '没有可重试的内容：它已与 $1 同步。',
  ],
  [/^Not rebased: (.+) is the default branch\.$/, '未变基：$1 是默认分支。'],
  [
    /^Not rebased: (.+) is the head of another open pull request \(#(\d+)\)\.$/,
    '未变基：$1 是另一个开启的拉取请求（#$2）的头分支。',
  ],
  [
    /^Not rebased: (.+) is a protected branch; bring it up to date yourself\.$/,
    '未变基：$1 是受保护分支；请自行将其更新到最新。',
  ],
  [
    /^Too many commits to rebase \((\d+); at most (\d+)\) — squash locally\.$/,
    '要变基的提交太多（$1；最多 $2 个）——请在本地压缩。',
  ],
  [
    /^Commit (.+) conflicts in (.+): binary files, or a file deleted on one side and changed on the other\. Rebase locally\.$/,
    '提交 $1 在 $2 中冲突：二进制文件，或一侧删除而另一侧修改的文件。请在本地变基。',
  ],
  [
    /^Commit (.+) conflicts in generated files \((.+)\)\. Rebase locally and regenerate them\.$/,
    '提交 $1 在生成的文件（$2）中冲突。请在本地变基并重新生成。',
  ],
  [
    /^Commit (.+) conflicts in (.+); AI already resolved (\d+) commits of this rebase\. Rebase locally\.$/,
    '提交 $1 在 $2 中冲突；AI 已解决此次变基的 $3 个提交。请在本地变基。',
  ],
  [
    /^Commit (.+) conflicts in (.+)\. Rebase locally\.$/,
    '提交 $1 在 $2 中冲突。请在本地变基。',
  ],
  [
    /^Rebasing onto (.+) stops at commit (.+), which conflicts in (.+)\. GitOrange is resolving it; merge again once it has\.$/,
    '变基到 $1 时在提交 $2 处停止，冲突文件：$3。GitOrange 正在解决；解决后再合并。',
  ],
  [
    /^Rebasing onto (.+) stops at commit (.+), which conflicts in (.+)\. Rebase it locally and push\.$/,
    '变基到 $1 时在提交 $2 处停止，冲突文件：$3。请在本地变基后推送。',
  ],

  // Reverting, learned edits, reviews that ran out of time or budget.
  [
    /^#(\d+) can’t be reverted cleanly: later changes to (.+) touch the same lines in (.+)\. Revert it by hand\.$/,
    '#$1 无法干净地还原：之后对 $2 的更改触及了 $3 中的相同行。请手动还原。',
  ],
  [
    /^(.+), the branch it merged into, no longer exists\.$/,
    '$1（它合并到的分支）已不存在。',
  ],
  [
    /^(.+) already undoes #(\d+): there is nothing to revert\.$/,
    '$1 已经撤销了 #$2：没有可还原的内容。',
  ],
  [
    /^Too many revert-(\d+) branches exist\. Delete some, then try again\.$/,
    'revert-$1 分支太多。请删除一些后重试。',
  ],
  [
    /^The branch (.+) was just created\. Try again\.$/,
    '分支 $1 刚刚被创建。请重试。',
  ],
  [
    /^The edit changed (.+): only AGENT\.md and knowledge\/ may change\.$/,
    '此次编辑改动了 $1：只有 AGENT.md 和 knowledge/ 可以更改。',
  ],
  [
    /^The edit writes (.+) both as a file and as a directory \((.+)\)\.$/,
    '此次编辑把 $1 同时作为文件和目录写入（$2）。',
  ],
  [
    /^(.+) is not UTF-8 text; the edit may not change it\.$/,
    '$1 不是 UTF-8 文本；此次编辑不能改动它。',
  ],
  [/^(.+) is not UTF-8 text\.$/, '$1 不是 UTF-8 文本。'],
  [/^(.+) is larger than 64 KB\.$/, '$1 超过 64 KB。'],
  [
    /^The edit changes (.+) bytes; at most 20 KB may change at once\.$/,
    '此次编辑改动了 $1 字节；一次最多只能改动 20 KB。',
  ],
  [/^AGENT\.md no longer parses: (.+)$/, 'AGENT.md 无法再解析：$1'],
  [/^The lesson ran out of time \((.+)\)\.$/, '课程超时（$1）。'],
  [/^The lesson used up its budget \((.+)\)\.$/, '课程用尽了预算（$1）。'],
  [/^The Pi review ran out of time \((.+)\)\.$/, 'Pi 评审超时（$1）。'],
  [
    /^The Pi review used up its budget \((.+)\)\.$/,
    'Pi 评审用尽了预算（$1）。',
  ],
  [
    /^The review model failed: Pi did not finish \((.+)\)\.$/,
    '评审模型失败：Pi 未完成（$1）。',
  ],
  [/^The review model failed: (.*)$/, '评审模型失败：$1'],

  // Checks.
  [
    /^(.+) \(run #(\d+)\)\. Fix them, then merge\.$/,
    '$1（运行 #$2）。请修复后再合并。',
  ],
  [/^(.+)\. Merge once they pass\.$/, '$1。检查通过后再合并。'],
  [/^Waiting for the "(.+)" check$/, '正在等待“$1”检查'],
  [/^The "(.+)" check failed$/, '“$1”检查失败'],
  [/^The "(.+)" check is running$/, '“$1”检查正在运行'],
  [/^The (.+) check failed$/, '$1 检查失败'],
  [/^The (.+) check is running$/, '$1 检查正在运行'],

  // The review gate's waiting list (AutoMergeReview).
  [/^@(.+) is reviewing$/, '@$1 正在评审'],
  [
    /^@(.+) flagged (\d+) findings? for a person$/,
    '@$1 标记了 $2 条评审意见待人工处理',
  ],
  [/^@(.+) requested (\d+) changes?$/, '@$1 请求了 $2 处更改'],
  [/^@(.+)'s review failed: (.+)$/, '@$1 的评审失败：$2'],
  [/^@(.+)'s review failed$/, '@$1 的评审失败'],
  [/^The review failed: (.+)$/, '评审失败：$1'],
  [/^Changes requested on (\d+) flags?$/, '有 $1 条评审意见被请求更改'],

  // The merge queue's blockers and the stack gate.
  [
    /^A person asked for changes on (\d+) findings?$/,
    '有人对 $1 条评审意见请求了更改',
  ],
  [/^Clashes with newer changes in (.+)$/, '与 $1 中更新的更改冲突'],
  [/^Must account for #(\d+) first: (.+)$/, '必须先处理 #$1：$2'],
  [/^Must account for #(\d+) first$/, '必须先处理 #$1'],
  [/^Being updated to build on #(\d+)$/, '正在更新以基于 #$1 构建'],
  [/^Depends in a circle on (.+)$/, '与 $1 循环依赖'],
  [
    /^Stacked on #(\d+): it lands after #(\d+)$/,
    '堆叠在 #$1 上：在 #$2 之后落地',
  ],
  [/^Lands after #(\d+)$/, '在 #$1 之后落地'],
  [/^Waits on #(\d+) to land first$/, '等待 #$1 先落地'],
  [/^Waits on #(\d+)$/, '等待 #$1'],
  [/^(.+) is reviewing it$/, '$1 正在评审'],
  [
    /^(.+) needs a person to decide (\d+) findings?$/,
    '$1 需要人工决定 $2 条评审意见',
  ],
  [/^(.+) asked for (\d+) changes?$/, '$1 请求了 $2 处更改'],
  [/^(.+)’s review failed$/, '$1 的评审失败'],
];
