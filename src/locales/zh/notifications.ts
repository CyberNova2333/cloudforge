/** Notifications: the bell, the inbox, subscribing, watching a repository, Settings → Notifications. */
export const notifications: Record<string, string> = {
  Notifications: '通知',
  'Notifications, {count} unread': '通知，{count} 条未读',
  'Notifications did not load': '通知未能加载',
  'News on issues and pull requests you follow. Settings → Notifications chooses which also arrive by email.':
    '你关注的议题和拉取请求的新动静。在“设置 → 通知”中选择哪些也发邮件。',
  Unread: '未读',
  'Mark all as read': '全部标为已读',
  'Mark as read': '标为已读',
  'Mark as unread': '标为未读',
  'Done: remove from the inbox': '完成：从收件箱移除',
  'Filter by reason': '按原因筛选',
  'Any reason': '任意原因',
  '{repo} only · show all': '仅 {repo} · 显示全部',
  'You’re all caught up': '全部看完了',
  'No notifications here': '这里没有通知',
  'Issues and pull requests you open, take part in, are mentioned in or assigned to show up here, and every one in repositories you watch.':
    '你创建、参与、被提及或被指派的议题和拉取请求会出现在这里，你关注的仓库里的所有议题和拉取请求也会。',
  'Page {page} of {pages} · {total} notifications':
    '第 {page} 页，共 {pages} 页 · {total} 条通知',

  // Why.
  Mentioned: '被提及',
  Assigned: '被指派',
  Participating: '参与',
  Watching: '关注',

  // What.
  '{who} opened it': '{who} 创建了它',
  '{who} commented': '{who} 发表了评论',
  '{who} closed it': '{who} 关闭了它',
  '{who} reopened it': '{who} 重新打开了它',
  '{who} merged it': '{who} 合并了它',
  '{who} assigned you': '{who} 指派给了你',
  '{who} changed the assignees': '{who} 修改了指派人',

  // Subscribing and watching.
  Subscribe: '订阅',
  Unsubscribe: '取消订阅',
  'You’re watching this repository.': '你在关注这个仓库。',
  'You’re receiving notifications because you’re subscribed.':
    '你已订阅，会收到通知。',
  'You’re not receiving notifications.': '你不会收到通知。',
  'Notifications for this repository': '这个仓库的通知',
  'Participating and @mentions': '仅参与和 @ 提及',
  'All activity': '全部动静',
  Ignore: '忽略',
  'People watching': '关注的人数',

  // Settings → Notifications.
  'Every notification goes to your inbox (the bell). Choose which ones also arrive at your account email.':
    '所有通知都会进入你的收件箱（铃铛）。在这里选择哪些也发到你的账户邮箱。',
  'This instance does not send email yet, so notifications reach your inbox only.':
    '这个实例还没有配置发信，通知只会进入收件箱。',
  'Email notifications': '邮件通知',
  'When you are mentioned or assigned, and on issues and pull requests you opened or took part in.':
    '被提及或被指派时，以及你创建或参与的议题和拉取请求有动静时。',
  'Also every issue and pull request in repositories you watch.':
    '再加上你关注的仓库里所有议题和拉取请求。',
  'No email': '不发邮件',
  'Notifications stay in your inbox only.': '通知只留在收件箱里。',
  'Emails go to your verified account email. Repositories you watch, and issues or pull requests you subscribe to, are chosen on their pages.':
    '邮件发到你已验证的账户邮箱。关注哪些仓库、订阅哪些议题或拉取请求，在各自的页面上选择。',
};
