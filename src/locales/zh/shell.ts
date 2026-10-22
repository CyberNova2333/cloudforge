/** Chinese for the shell area (rail, top band, menus, search) and the pages outside it (sign in, setup, invitation, authorization, 404, public home): see index.ts for the terms. */
export const shell: Record<string, string> = {
  // Account menu
  System: '跟随系统',
  Light: '浅色',
  Dark: '深色',
  'Account and theme': '账户与主题',
  Theme: '主题',
  Appearance: '外观',
  'Your profile': '你的个人资料',
  'Your repositories': '你的仓库',
  'Tokens, MCP server, emails': '令牌、MCP 服务器、邮箱',

  // Frame, rail and top band
  'Skip to content': '跳到正文',
  'Create new': '新建',
  'New repository': '新建仓库',
  'New reviewer': '新建评审 Agent',
  'New access token': '新建访问令牌',
  'Invite member': '邀请成员',
  'Search {name}': '搜索 {name}',
  'Type / to search': '输入 / 开始搜索',
  'Search results': '搜索结果',
  'Searching…': '搜索中…',
  'Search isn’t available right now.': '搜索暂时不可用。',
  'No results for “{q}”.': '没有找到“{q}”的结果。',
  '{name} home': '{name} 首页',
  'Instance: {name}': '实例：{name}',
  Instance: '实例',
  'single-tenant': '单租户',
  'Instance settings': '实例设置',
  'Recent repositories': '最近访问的仓库',
  'Keep the rail open': '保持侧栏展开',
  'Unpin: the rail collapses and opens when you point at it':
    '取消固定：侧栏会收起，鼠标指向时展开',
  Unpin: '取消固定',
  'Keep open': '保持展开',
  '{label}: open Site admin, Setup': '{label}：打开站点管理员的设置检查',
  'This deployment is misconfigured. Open Site admin → Setup':
    '此部署存在配置问题。请打开 站点管理员 → 设置检查',
  'Approvals, {count} waiting on you': '待审批，{count} 项等你处理',
  'Approvals waiting on you': '等你处理的待审批事项',
  'Open navigation': '打开导航',
  '{n} setup error': '{n} 个配置错误',
  '{n} setup errors': '{n} 个配置错误',

  // 404 and the public home
  'This page does not exist': '页面不存在',
  'This is not the web page you are looking for. It may have moved, or you may not have access to it.':
    '这不是你要找的页面。它可能已被移动，或者你没有访问权限。',
  'Go home': '返回首页',
  'Browse repositories': '浏览仓库',
  'Public repositories': '公开仓库',
  'Repositories on {name} that anyone can read and clone. Members sign in to see everything shared with them.':
    '{name} 上任何人都能查看和克隆的仓库。成员登录后可以看到与自己共享的所有内容。',
  'the repositories': '仓库列表',
  'Loading repositories': '正在加载仓库',
  'No public repositories yet': '还没有公开仓库',
  'When a member makes a repository public, it shows up here.':
    '成员把仓库设为公开后，会显示在这里。',
  'Updated {when}': '更新于 {when}',

  // Sign in
  'Incorrect username or password.': '用户名或密码不正确。',
  'Sign in to {name}': '登录 {name}',
  'Username or email address': '用户名或邮箱地址',
  Password: '密码',
  'Signing in…': '登录中…',
  'New to this instance? Ask an administrator for an invitation.':
    '第一次使用这个实例？请向管理员索取邀请。',

  // Sign-in and sign-up errors from better-auth (shown through errorMessage → tServer)
  'Invalid email or password': '邮箱或密码不正确',
  'Invalid username or password': '用户名或密码不正确',
  'You have been banned from this application': '你的账户已被封禁',
  'Email not verified': '邮箱尚未验证',
  'Failed to create user': '创建用户失败',
  'Username is invalid': '用户名无效',
  'Username is already taken. Please try another.':
    '用户名已被占用，请换一个。',
  'Username is too long': '用户名太长',
  'Username is too short': '用户名太短',
  'User already exists.': '用户已存在。',
  'User already exists. Use another email.': '用户已存在，请使用其他邮箱。',
  'User not found': '用户不存在',
  'Invalid email': '邮箱无效',
  'Invalid password': '密码无效',
  'Invalid origin': '来源无效',
  'Invalid token': '令牌无效',
  'Password too long': '密码太长',
  'Password too short': '密码太短',
  'Session expired. Re-authenticate to perform this action.':
    '会话已过期，请重新登录后再操作。',

  // First-run setup and invitations
  'Welcome to {name}': '欢迎使用 {name}',
  'Set up': '初始设置',
  'Let’s set up your instance. Create the first administrator account. You can invite the rest of your team once you are in.':
    '开始设置你的实例：先创建第一个管理员账户，进入后再邀请团队里的其他人。',
  'Setup code': '设置码',
  'Printed at the end of {command}.': '在 {command} 运行结束时打印。',
  'Full name': '姓名',
  Username: '用户名',
  'Email address': '邮箱地址',
  'Make sure it is at least 8 characters.': '至少 8 个字符。',
  'Creating account…': '正在创建账户…',
  'Create admin account': '创建管理员账户',
  'Invitation not found': '邀请不存在',
  'This invitation is invalid, has expired, or was already used.':
    '这个邀请无效、已过期或已被使用。',
  'Go to sign in': '前往登录',
  'Join {name}': '加入 {name}',
  Join: '加入',
  '{inviter} invited you to join.': '{inviter} 邀请你加入。',
  'You have been invited to join.': '你收到了加入邀请。',
  'Create account': '创建账户',

  // OAuth consent (connecting an MCP client)
  'Authorization link': '授权链接',
  Authorize: '授权',
  'This authorization link is incomplete or has expired. Start the connection again from your app.':
    '这个授权链接不完整或已过期。请从你的应用重新发起连接。',
  'An application': '某个应用',
  'Something went wrong. Start the connection again from your app.':
    '出了点问题。请从你的应用重新发起连接。',
  'Network error. Try again.': '网络错误，请重试。',
  '{app} wants to access your {name} account': '{app} 想要访问你的 {name} 账户',
  'This app isn’t registered with {name}. Start the connection again from your app.':
    '这个应用没有在 {name} 注册。请从你的应用重新发起连接。',
  'Signed in as {user}. {app} will act as you.':
    '当前登录身份：{user}。{app} 将以你的身份操作。',
  'Read your repositories': '读取你的仓库',
  '{tools}. Includes private repositories you have access to.':
    '{tools}。包括你有权访问的私有仓库。',
  'See the repositories you can see': '查看你能看到的仓库',
  'Make changes': '进行更改',
  '{tools} as you.': '以你的身份：{tools}。',
  'Create repositories': '创建仓库',
  'Know who you are': '知道你是谁',
  'Your name, username, and email address.': '你的姓名、用户名和邮箱地址。',
  'Your name, username.': '你的姓名和用户名。',
  'Stays connected until you disconnect it in Settings → MCP server.':
    '保持连接，直到你在 设置 → MCP 服务器 中断开。',
  'Cancelling…': '正在取消…',
  'Authorizing…': '正在授权…',
  'Authorize {app}': '授权 {app}',
  'From {host}': '来自 {host}',
};
