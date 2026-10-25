/** Chinese for the admin area (site admin, personal settings): see index.ts for the terms. */
export const admin: Record<string, string> = {
  // src/pages/Admin.tsx — People and team
  'Who can sign in, whether this deployment is set up properly, and the settings every repository shares.':
    '谁可以登录、此部署是否已正确设置，以及所有仓库共享的设置。',
  'Saved. Team repositories live at /{slug}/<repo>.':
    '已保存。团队仓库位于 /{slug}/<repo>。',
  'The one shared team. Its repositories are visible to every member, and live at {path}.':
    '唯一的共享团队。它的仓库对所有成员可见，位于 {path}。',
  Team: '团队',
  'the team': '团队',
  'Team name': '团队名称',
  'URL name': 'URL 名称',
  "Changing the URL name changes every team repository's URL and clone address.":
    '更改 URL 名称会改变每个团队仓库的 URL 和克隆地址。',
  'Save team': '保存团队',
  Rename: '重命名',
  'No team yet.': '还没有团队。',
  'Create it to allow team repositories.': '创建团队后即可使用团队仓库。',
  'Create team': '创建团队',
  Members: '成员',
  "Self sign-up is off. People join by invitation. Members can't be removed and roles can't be changed from here.":
    '未开放自助注册，成员通过邀请加入。无法在此移除成员或更改角色。',
  'Invite a member': '邀请成员',
  "They'll receive an email with a link to create their account. The link expires in 7 days.":
    '对方会收到一封包含创建账户链接的邮件。链接 7 天后过期。',
  'Invitation sent to {email}. You can also share this link directly:':
    '邀请已发送至 {email}。你也可以直接分享此链接：',
  "We couldn't send the email to {email}. Share this link with them instead:":
    '无法向 {email} 发送邮件。请改为把此链接分享给对方：',
  'Invitation link': '邀请链接',
  'Copy the invitation link': '复制邀请链接',
  'Reset password': '重置密码',
  'A one-time link to choose a new password was emailed to @{username}. You can also hand it over directly:':
    '设置新密码的一次性链接已发到 @{username} 的邮箱。你也可以直接把它交给对方：',
  'Hand this one-time link to @{username} to choose a new password:':
    '把这个一次性链接交给 @{username}，用来设置新密码：',
  'Password reset link': '密码重置链接',
  'Copy the password reset link': '复制密码重置链接',
  'It works once, until {date}. Using it signs out their other sessions.':
    '仅可使用一次，有效期至 {date}。使用后对方的其他会话会被登出。',
  Role: '角色',
  Member: '成员',
  'Sending…': '发送中…',
  'Send invitation': '发送邀请',
  'the members': '成员',
  'Joined {when}': '加入于 {when}',
  'Pending invitations': '待处理的邀请',
  'the invitations': '邀请',
  'No pending invitations.': '没有待处理的邀请。',
  'Invited {when} · expires {expires}': '邀请于 {when} · 过期于 {expires}',
  Revoke: '撤销',
  'Revoke invitation': '撤销邀请',
  'Revoking…': '撤销中…',
  'Revoke the invitation to {email}': '撤销发送给 {email} 的邀请',

  // src/pages/AdminAgents.tsx
  'Reviewer agents are accounts that review pull requests in the repositories that invite them. Each one is defined by AGENT.md in its own repository, which anyone who can push there can edit.':
    '评审 Agent 是会在邀请它们的仓库中评审拉取请求的账户。每个 Agent 由自己仓库中的 AGENT.md 定义，任何有推送权限的人都可以编辑它。',
  'Agents directory': 'Agent 目录',
  '{n} agent': '{n} 个 Agent',
  '{n} agents': '{n} 个 Agent',
  'Deleted @{handle}. It’s removed from every repository; its past reviews keep its name, and its repository stays until you delete it. Create it again with the same handle to bring it back.':
    '已删除 @{handle}。它已从所有仓库中移除；过去的评审会保留它的名字，它的仓库会一直保留到你删除为止。用同一个用户名重新创建即可恢复它。',
  'the agents': 'Agent 列表',
  'No agents yet.': '还没有 Agent。',
  'Create the recommended crew, or a reviewer of your own.':
    '创建推荐的评审组，或你自己的评审 Agent。',
  'Repository deleted': '仓库已删除',
  'created {when}': '创建于 {when}',
  'Delete @{handle}': '删除 @{handle}',
  'Deleting…': '正在删除…',

  // src/pages/AdminAudit.tsx
  'Audit log': '审计日志',
  'Who did what on this instance, newest first: merges, decisions, access, settings and what CloudForge did on its own. Entries are recorded as they happen and can’t be edited.':
    '谁在这个实例上做了什么，最新的在前：合并、决定、访问、设置，以及 CloudForge 自行执行的操作。记录发生时即写入，无法编辑。',
  'Refreshing…': '刷新中…',
  Refresh: '刷新',
  Show: '显示',
  Everything: '全部',
  'Audit events': '审计事件',
  'the audit log': '审计日志',
  'Nothing has been recorded yet.': '还没有任何记录。',
  'Merges, decisions, setting changes and access changes appear here as they happen.':
    '合并、决定、设置更改和访问权限更改发生后会显示在这里。',
  'None of the loaded events match.': '已加载的事件中没有符合条件的。',
  'Load older events to look further back, or show everything.':
    '加载更早的事件以查看更久以前，或显示全部。',
  'Show everything to see all of them.': '显示全部以查看所有事件。',
  'Show everything': '显示全部',
  'Could not load more events.': '无法加载更多事件。',
  'Load older': '加载更早的记录',
  // The category labels come from src/lib/auditText.ts (same words as lib.ts).
  Merging: '合并',
  Decisions: '决策',
  'Access and agents': '访问与 Agent',
  'Pull request activity': '拉取请求活动',

  // src/pages/AdminUsage.tsx
  'Usage and cost': '用量与费用',
  'What this CloudForge deployment uses on Cloudflare, and what it would cost. Estimates from Cloudflare analytics (filtered to this deployment’s own Worker, Durable Objects, Workflows, D1 database, R2 buckets, and Artifacts namespace) and from CloudForge’s own records. Not an invoice: Cloudflare’s Billing → Billable Usage page has the exact account total.':
    '这个 CloudForge 部署在 Cloudflare 上的用量，以及对应的费用估算。估算来自 Cloudflare 分析（已过滤到这个部署自己的 Worker、Durable Objects、Workflows、D1 数据库、R2 存储桶和 Artifacts 命名空间）和 CloudForge 自己的记录。这不是账单：Cloudflare 的 Billing → Billable Usage 页面才有账户的准确总额。',
  'Cloudflare analytics last synced {when}.':
    'Cloudflare 分析上次同步于 {when}。',
  Month: '月份',
  'Syncing…': '同步中…',
  'Sync now': '立即同步',
  'the usage report': '用量报告',
  'Cloudflare analytics are not set up, so only what CloudForge records itself (Actions runners, Workers AI calls, emails) is shown. Add the {secret} secret: an account API token with {scope}.':
    '未设置 Cloudflare 分析，因此只显示 CloudForge 自己记录的内容（Actions 运行器、Workers AI 调用、邮件）。请添加 {secret} 密钥：一个具有 {scope} 权限的账户 API 令牌。',
  'CloudForge usage at list price': '按标价计算的 CloudForge 用量',
  'Every unit priced, no allowances': '所有用量都按标价计算，不扣包含额度',
  'If CloudForge had the allowances to itself':
    '如果包含额度全部归 CloudForge 使用',
  'Usage above the included amounts': '超出包含额度的用量',
  'Projected for the month': '本月预计',
  '{amount} with allowances': '扣除包含额度后为 {amount}',
  'Workers Paid plan fee': 'Workers Paid 套餐费',
  'Per account, not counted above': '按账户收取，未计入以上金额',
  'Included allowances and the plan fee belong to the whole Cloudflare account. If anything else runs on it, the allowances are shared and the real bill for CloudForge’s usage is somewhere between the two figures above.':
    '包含额度和套餐费属于整个 Cloudflare 账户。如果账户上还运行着其他东西，额度需要共享，CloudForge 用量的实际账单会介于上面两个数字之间。',
  'Estimated cost per day': '每日预计费用',
  'Highest day: {amount}. Days without a bar have no recorded cost yet.':
    '最高的一天：{amount}。没有柱子的日期还没有记录到费用。',
  'Cloudflare analytics': 'Cloudflare 分析',
  'Recorded by CloudForge': 'CloudForge 记录',
  Estimate: '估算',
  'Not configured': '未配置',
  Unavailable: '不可用',
  Metric: '指标',
  'CloudForge usage': 'CloudForge 用量',
  'Included (whole account)': '包含额度（整个账户）',
  'List price': '标价',
  'With allowance': '扣除包含额度后',
  Projected: '预计',
  'Cloudflare bills this from {source}.': 'Cloudflare 按 {source} 计费。',
  'Synced {n} days; some metrics were unavailable (see below).':
    '已同步 {n} 天；部分指标不可用（见下）。',
  'Synced {n} days.': '已同步 {n} 天。',
  'By product': '按产品',
  'Actions: {minutes} runner minutes, {cost}':
    'Actions：{minutes} 运行器分钟，{cost}',
  '{n} runner(s) running now are counted up to this moment.':
    '当前正在运行的 {n} 个运行器也计入到此刻。',
  'By repository': '按仓库',
  'No Actions jobs ran this month.': '本月没有运行 Actions 作业。',
  '{n} minutes': '{n} 分钟',
  'By runner size': '按运行器规格',
  'Workers AI: {calls} calls, {cost}': 'Workers AI：{calls} 次调用，{cost}',
  '{n} call(s) reported no token counts and are not priced.':
    '{n} 次调用未报告令牌数，未计入费用。',
  'By feature': '按功能',
  'No AI calls this month.': '本月没有 AI 调用。',
  '{calls} calls · {in} in · {out} out tokens':
    '{calls} 次调用 · 输入 {in} · 输出 {out} 令牌',
  '{n} calls': '{n} 次调用',
  'AI Gateway {id} (whole gateway)': 'AI Gateway {id}（整个网关）',
  '{requests} requests, {cost} by the gateway’s own estimate.':
    '{requests} 次请求，按网关自己的估算为 {cost}。',
  '{requests} requests.': '{requests} 次请求。',
  'Not configured.': '未配置。',
  'Unavailable.': '不可用。',
  'For the whole gateway, which other apps or a dev instance may share; not added to CloudForge’s totals. CloudForge’s own AI cost is the Workers AI section above.':
    '这是整个网关的数据，其他应用或开发实例可能共享；未计入 CloudForge 的总额。CloudForge 自己的 AI 费用见上方的 Workers AI 部分。',
  'Not measured': '未计量',
  'Workers Paid list prices, last checked {date}: {sources}.':
    'Workers Paid 标价，最近核对于 {date}：{sources}。',

  // src/pages/SettingsEmails.tsx
  Emails: '邮箱',
  'We sent a verification link to {email}. Open it while signed in to finish.':
    '我们已向 {email} 发送验证链接。请在登录状态下打开链接完成验证。',
  '{email} was added, but the verification email could not be sent. Try "Resend" later.':
    '{email} 已添加，但验证邮件发送失败。请稍后尝试“重新发送”。',
  'Commits whose author or committer email is one of these are linked to your profile. Add the addresses you set as {code} in git. Other addresses must be verified before they count.':
    '作者或提交者邮箱是这些地址之一的提交会关联到你的个人资料。请添加你在 git 中设为 {code} 的地址。其他地址必须先验证才能生效。',
  "This instance cannot send email, so verification links can't be delivered and new addresses stay unverified. Ask a site admin to configure email sending.":
    '这个实例无法发送邮件，因此验证链接无法送达，新地址会一直处于未验证状态。请联系站点管理员配置邮件发送。',
  'Your email addresses': '你的邮箱地址',
  'Email addresses': '邮箱地址',
  'your email addresses': '你的邮箱地址',
  'Your account email.': '你的账户邮箱。',
  Primary: '主要',
  'Add an email address': '添加邮箱地址',
  Label: '标签',
  '(optional)': '（可选）',
  'Work, Personal…': '工作、个人…',
  'Adding…': '正在添加…',
  'We send a link to verify it. Open the link while you are signed in.':
    '我们会发送验证链接。请在登录状态下打开该链接。',
  'Label for {email}': '{email} 的标签',
  'Label: {label}': '标签：{label}',
  'Add label': '添加标签',
  Verified: '已验证',
  'The link expired; anyone may now claim this address. Resend to keep it.':
    '链接已过期；现在任何人都可能认领这个地址。请重新发送以保留它。',
  'Open the link we emailed to verify': '打开我们邮件中的链接进行验证',
  'Unverified · link expired': '未验证 · 链接已过期',
  Unverified: '未验证',
  Resend: '重新发送',
  'Delete address': '删除地址',
  'Delete {email}': '删除 {email}',
  'Verify email': '验证邮箱',
  'This verification link is incomplete.': '这个验证链接不完整。',
  '{email} is verified. Commits authored with it are now linked to your profile.':
    '{email} 已验证。使用该邮箱创作的提交现在会关联到你的个人资料。',
  'Back to email settings': '返回邮箱设置',

  // src/pages/SettingsMcp.tsx
  'MCP server': 'MCP 服务器',
  'Other clients': '其他客户端',
  Terminal: '终端',
  'Add the server from your terminal:': '在终端中添加服务器：',
  'Then start Claude Code, run {command}, choose {server}, and select {auth}. Your browser opens {app}: sign in and allow access.':
    '然后启动 Claude Code，运行 {command}，选择 {server}，再选择 {auth}。浏览器会打开 {app}：登录并允许访问。',
  'Open {link} (in Claude.ai or the Claude desktop app).':
    '打开 {link}（在 Claude.ai 或 Claude 桌面应用中）。',
  'Name it {name} and paste the server URL {url}.':
    '将其命名为 {name}，并粘贴服务器 URL {url}。',
  'Select {connect}, sign in to {app}, and allow access. The connector then works in Claude on the web, desktop, and mobile.':
    '选择 {connect}，登录 {app} 并允许访问。此后该连接器可在网页版、桌面版和移动版 Claude 中使用。',
  Authenticate: '认证',
  Connect: '连接',
  'Needs login': '需要登录',
  'Add to Cursor': '添加到 Cursor',
  "Or add it to {user} (or a project's {project}):":
    '或者将其添加到 {user}（或项目的 {project}）：',
  'Cursor shows {needsLogin} next to the server in Settings → MCP; select it to sign in to {app}.':
    'Cursor 会在 设置 → MCP 中该服务器旁边显示 {needsLogin}；选择它即可登录 {app}。',
  'Add the server from your terminal, then sign in:':
    '在终端中添加服务器，然后登录：',
  'Or add it to {file} under {section} with {setting}.':
    '或者将其添加到 {file} 的 {section} 下，并设置 {setting}。',
  "Any MCP client that supports remote servers works. Add a {transport} server with the URL {url}. The client discovers {app}'s sign-in automatically (OAuth 2.1 with PKCE and dynamic client registration), so there's no token to copy: you sign in and approve access in your browser.":
    '任何支持远程服务器的 MCP 客户端都可以。添加一个 {transport} 服务器，URL 为 {url}。客户端会自动发现 {app} 的登录信息（OAuth 2.1，使用 PKCE 和动态客户端注册），因此不需要复制令牌：你在浏览器中登录并批准访问即可。',
  'Read-only': '只读',
  'Makes changes': '会做更改',
  ' (required)': '（必填）',
  ' — one of {values}': ' — 以下之一：{values}',
  ', redirects to {host}': '，重定向到 {host}',
  'Connect Claude, Cursor and other AI tools to {app} through the Model Context Protocol. They act as you, so they see the repositories you can see, and they can create repositories for you.':
    '通过模型上下文协议（Model Context Protocol）将 Claude、Cursor 等 AI 工具连接到 {app}。它们以你的身份操作，因此能看到你能看到的仓库，也能为你创建仓库。',
  'Connected apps': '已连接的应用',
  'your connected apps': '你已连接的应用',
  'No apps are connected yet.': '还没有连接任何应用。',
  'Apps appear here after you allow them access. Set one up below.':
    '允许应用访问后，它们会显示在这里。请在下方进行设置。',
  Moderator: '审核者',
  'Connected {when}': '连接于 {when}',
  Connected: '已连接',
  '{app} is a moderator': '{app} 是审核者',
  Disconnect: '断开连接',
  'Disconnect {app}': '断开连接 {app}',
  'Disconnecting…': '正在断开…',
  'Reconnect the app to see the moderator tools.':
    '重新连接该应用以查看审核者工具。',
  'Make {app} a moderator': '将 {app} 设为审核者',
  'Making moderator…': '正在设为审核者…',
  'Make moderator': '设为审核者',
  'Make {app} ({identity}) a moderator? A moderator can approve agent findings and pull requests as you.':
    '将 {app}（{identity}）设为审核者？审核者可以以你的身份批准 Agent 评审意见和拉取请求。',
  'Disconnecting stops an app immediately; it has to ask for your approval again to reconnect.':
    '断开连接会立即停止该应用；它必须再次请求你的批准才能重新连接。',
  'A moderator can approve agent findings and pull requests as you.':
    '审核者可以以你的身份批准 Agent 评审意见和拉取请求。',
  'Letting Claude answer for you': '让 Claude 代你回答',
  'moderator app': '审核者应用',
  'Let Claude decide': '让 Claude 决定',
  'Security and Data always come to you.':
    'Security 和 Data 的评审意见始终由你处理。',
  'A {moderatorApp} (above) is a tool you connected, such as Claude Code. It can approve agent findings and pull requests as you. Findings from Security and Data need your own written reason, so the app has to ask you for it.':
    '{moderatorApp}（上方）是你连接的某个工具，例如 Claude Code。它可以以你的身份批准 Agent 评审意见和拉取请求。来自 Security 和 Data 的评审意见需要你本人填写书面理由，因此应用必须来询问你。',
  "{letClaudeDecide} is different: {app}'s own AI can answer reviewer findings on your pull requests for you, one reviewer at a time, and you can undo any answer while the pull request is open. {securityAndData}":
    '{letClaudeDecide} 有所不同：{app} 自己的 AI 可以代你回答拉取请求上的评审意见，一次处理一个评审者，并且在拉取请求仍然打开时可以撤销任何回答。{securityAndData}',
  'Turn it on in Approvals': '在待审批中开启',
  'Set it up': '设置步骤',
  'the server details': '服务器信息',
  'Server URL': '服务器 URL',
  'Copy the server URL': '复制服务器 URL',
  'MCP client': 'MCP 客户端',
  'To check it works, ask: {question} Naming the server makes the AI call it instead of guessing.':
    '要检查是否可用，可以这样问：{question} 指明服务器名称能让 AI 直接调用它，而不是猜测。',
  '“Which repositories do I have on {app}? Use the {server} MCP server.”':
    '“我在 {app} 上有哪些仓库？请使用 {server} MCP 服务器。”',
  Tools: '工具',
  'Moderator tools': '审核者工具',
  'Only apps you mark as a moderator above see these.':
    '只有你在上方标记为审核者的应用才能看到这些工具。',

  // src/pages/SettingsTokens.tsx
  'Personal access tokens': '个人访问令牌',
  'No expiration': '永不过期',
  Expired: '已过期',
  'Expires {date}': '到期时间 {date}',
  'Last used {when}': '上次使用于 {when}',
  'Never used': '从未使用',
  'Delete token': '删除令牌',
  'Delete token {name}': '删除令牌 {name}',
  'A token is a password for git over HTTPS and for Git LFS. Use it when you clone or push. A read-only token can clone and fetch but never push.':
    '令牌是 git 通过 HTTPS 以及 Git LFS 使用的密码。克隆或推送时使用它。只读令牌可以克隆和拉取，但不能推送。',
  Access: '权限',
  'Read and write': '读写',
  'Read only': '只读',
  'Your tokens': '你的令牌',
  'Tokens you have generated. A deleted token stops working at once.':
    '你生成过的令牌。删除后的令牌会立即失效。',
  'your tokens': '你的令牌',
  'You have no personal access tokens.': '你还没有个人访问令牌。',
  'Generate one below to use git over HTTPS.':
    '在下方生成一个，以便通过 HTTPS 使用 git。',
  "{bold} You won't be able to see it again.": '{bold} 之后将无法再次查看。',
  'Copy your new token now.': '立即复制你的新令牌。',
  'Your new token': '你的新令牌',
  'Copy the token': '复制令牌',
  'Generate a new token': '生成新令牌',
  Note: '备注',
  'What is this token for?': '这个令牌用于什么？',
  Expiration: '有效期',
  '7 days': '7 天',
  '30 days': '30 天',
  '90 days': '90 天',
  '1 year': '1 年',
  'Generating…': '生成中…',
  'Generate token': '生成令牌',

  // src/components/AdminSettings.tsx
  'keep forever': '永久保留',
  '{n} days': '{n} 天',
  days: '天',
  'Keep forever': '永久保留',
  'Resetting…': '重置中…',
  'Reset to default': '重置为默认值',
  'Set here {when}. Default: {value}.': '在此设置于 {when}。默认值：{value}。',
  'Set here. Default: {value}.': '已在此设置。默认值：{value}。',
  'Using the default ({value}).': '正在使用默认值（{value}）。',
  'Saved.': '已保存。',
  "Instance-wide settings. Defaults come from the deploy's configuration; anything set here takes effect right away, without a deploy.":
    '实例范围的设置。默认值来自部署配置；在此设置的任何内容都会立即生效，无需重新部署。',
  'the instance settings': '实例设置',
  '{n} workflow run stored; the oldest finished {when}.':
    '已存储 {n} 个工作流运行；最早的在 {when} 结束。',
  '{n} workflow runs stored; the oldest finished {when}.':
    '已存储 {n} 个工作流运行；最早的在 {when} 结束。',
  '{n} workflow run stored.': '已存储 {n} 个工作流运行。',
  '{n} workflow runs stored.': '已存储 {n} 个工作流运行。',
  'Cleanup runs once a day.': '清理每天运行一次。',
  'Cleanup last ran {when} and deleted {n} run (more remain; it continues tomorrow).':
    '清理上次运行于 {when}，删除了 {n} 个运行（还有剩余，明天继续）。',
  'Cleanup last ran {when} and deleted {n} runs (more remain; it continues tomorrow).':
    '清理上次运行于 {when}，删除了 {n} 个运行（还有剩余，明天继续）。',
  'Cleanup last ran {when} and deleted {n} run.':
    '清理上次运行于 {when}，删除了 {n} 个运行。',
  'Cleanup last ran {when} and deleted {n} runs.':
    '清理上次运行于 {when}，删除了 {n} 个运行。',

  // src/components/AdminSetup.tsx
  Error: '错误',
  Warning: '警告',
  OK: '正常',
  'Testing…': '测试中…',
  Test: '测试',
  'Sends one tiny Workers AI request (a few tokens) through the gateway.':
    '通过网关发送一个很小的 Workers AI 请求（几个令牌）。',
  'How to fix': '修复方法',
  'Open dashboard': '打开控制台',
  'Copy command': '复制命令',
  'Setup checks': '设置检查',
  'Checking…': '检查中…',
  'Re-check': '重新检查',
  "This deployment's secrets, bindings, and variables. Secret values are never shown; only whether they're set.":
    '此部署的密钥、绑定和变量。密钥值不会显示，只显示是否已设置。',
  'the setup checks': '设置检查',
  '{n} error to fix': '有 {n} 个错误需要修复',
  '{n} errors to fix': '有 {n} 个错误需要修复',
  'No errors; some features are off or misconfigured':
    '没有错误；部分功能已关闭或配置有误',
  'Everything is set up': '一切已设置妥当',
  '{n} error': '{n} 个错误',
  '{n} errors': '{n} 个错误',
  '{n} warning': '{n} 个警告',
  '{n} warnings': '{n} 个警告',
  '{n} OK': '{n} 项正常',
  'checked {when}': '检查于 {when}',
  '{n} check passed': '{n} 项检查通过',
  '{n} checks passed': '{n} 项检查通过',
  Hide: '隐藏',

  // src/components/SetFrame.tsx
  'Access tokens': '访问令牌',
  'People and team': '成员与团队',
  'Your settings': '你的设置',
  'follows your browser': '跟随浏览器',
  'Instance default': '实例默认',
  'Currently {language}, set by a site admin.':
    '当前为{language}，由站点管理员设置。',
  Language: '语言',
  'The language of the interface. It is kept with your account, so it follows you to every browser you sign in on.':
    '界面语言。它保存在你的账户里，在任何浏览器上登录都会生效。',
  'your preferences': '你的偏好设置',
  'Interface language': '界面语言',
  'This page is shown in {language} now.': '当前页面以{language}显示。',
  'Self sign-up is on for {domains}; anyone else joins by invitation.':
    '已对 {domains} 开放自助注册，其他人需通过邀请加入。',
  'Self sign-up is on: anyone who can reach this instance can create an account.':
    '已开放自助注册：任何能访问这个实例的人都可以创建账户。',
  'Self sign-up is off. People join by invitation.':
    '未开放自助注册，成员需通过邀请加入。',
  'Change it in {settings}.': '可在{settings}中修改。',
  "Members can't be removed and roles can't be changed from here.":
    '这里不能移除成员，也不能修改角色。',
  empty: '空',
  Enabled: '已开启',
  Disabled: '已关闭',
  enabled: '开启',
  disabled: '关闭',
};
