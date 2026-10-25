/** Issues and labels: the list, an issue's page, the labels page. (label 标记, so it never reads as a git tag 标签.) */
export const issues: Record<string, string> = {
  Issues: '议题',
  'New issue': '新建议题',
  'Create issue': '创建议题',
  Labels: '标记',
  'Not planned': '不计划处理',
  'Closed as not planned': '已关闭：不计划处理',
  'Closed as completed': '已关闭：已完成',
  'Closes on merge': '合并时关闭',
  'Closes this': '会关闭此议题',
  'Say what happened or what is needed, so whoever picks it up can act on it.':
    '写清楚发生了什么或需要什么，让接手的人可以直接动手。',

  // The timeline.
  '{who} closed this as completed in {pull} {when}':
    '{who} {when}通过 {pull} 将其关闭（已完成）',
  '{who} closed this as not planned {when}':
    '{who} {when}将其关闭（不计划处理）',
  '{who} closed this as completed {when}': '{who} {when}将其关闭（已完成）',
  '{who} reopened this {when}': '{who} {when}重新打开了它',
  '{who} added the {label} label {when}': '{who} {when}添加了标记 {label}',
  '{who} removed the {label} label {when}': '{who} {when}移除了标记 {label}',
  '{who} self-assigned this {when}': '{who} {when}指派给了自己',
  '{who} removed their assignment {when}': '{who} {when}取消了对自己的指派',
  '{who} assigned {person} {when}': '{who} {when}指派给了 {person}',
  '{who} unassigned {person} {when}': '{who} {when}取消了对 {person} 的指派',
  '{who} changed the title from {from} to {to} {when}':
    '{who} {when}把标题从 {from} 改为 {to}',
  '{who} linked {pull}, which closes this when it merges, {when}':
    '{who} {when}关联了 {pull}，它合并时会关闭此议题',
  '{who} mentioned this in {pull} {when}': '{who} {when}在 {pull} 中提到了它',
  '{author} opened this issue {when}': '{author} {when}创建了此议题',
  'Delete comment': '删除评论',

  // The side.
  Assignees: '指派人',
  'Unassign {name}': '取消指派 {name}',
  'Nobody yet': '尚未指派',
  'Assign yourself': '指派给自己',
  'Assign someone by username': '按用户名指派',
  'None yet': '暂无',
  'Choose labels': '选择标记',
  'Create labels': '创建标记',
  'Write “Fixes #{n}” in a pull request to close this issue when it merges.':
    '在拉取请求中写“Fixes #{n}”，合并时即可关闭此议题。',

  // The page's actions.
  'The issue did not load': '议题未能加载',
  'Close as not planned': '以“不计划处理”关闭',
  'Close issue': '关闭议题',
  'Reopen issue': '重新打开议题',
  'to join the conversation.': '后参与讨论。',
  'Delete issue': '删除议题',
  'Delete issue #{n} for good': '永久删除议题 #{n}',

  // The list.
  'Assigned to {people}': '指派给 {people}',
  'Issues did not load': '议题未能加载',
  'No issues match these filters': '没有符合这些筛选条件的议题',
  "There aren't any closed issues.": '没有已关闭的议题。',
  "There aren't any open issues.": '没有未关闭的议题。',
  'Clear the filters': '清除筛选条件',
  'Issues track bugs, ideas and work to do. Write “Fixes #12” in a pull request to close issue 12 when it merges.':
    '议题用来记录缺陷、想法和待办工作。在拉取请求中写“Fixes #12”，合并时即可关闭议题 12。',
  'Page {page} of {pages} · {total} issues':
    '第 {page} 页，共 {pages} 页 · {total} 个议题',
  'Bugs, ideas and work to do in this repository.':
    '这个仓库的缺陷、想法和待办工作。',
  'Issue state': '议题状态',
  'Filter by label': '按标记筛选',
  'Any label': '任意标记',
  'Filter by assignee': '按指派人筛选',
  Anyone: '任何人',
  'Assigned to me': '指派给我的',
  Nobody: '未指派',
  'Search issues': '搜索议题',

  // Labels.
  'Label preview': '标记预览',
  'Label name': '标记名称',
  Color: '颜色',
  'Pick a color': '选择颜色',
  'Delete label': '删除标记',
  'Delete label {name}': '删除标记 {name}',
  'Labels sort issues by kind, area or priority.':
    '用标记按类型、领域或优先级给议题分类。',
  'New label': '新建标记',
  'Create label': '创建标记',
  'Labels did not load': '标记未能加载',
  'No labels yet': '还没有标记',
  'Create a few, such as bug, docs or good first issue.':
    '先建几个，例如 bug、docs 或 good first issue。',
  '{n} open issue': '{n} 个未关闭的议题',
  '{n} open issues': '{n} 个未关闭的议题',

  // Repository settings.
  'Track bugs, ideas and work to do in this repository. Turning issues off hides them and keeps them; turning them back on shows them again.':
    '在这个仓库中记录缺陷、想法和待办工作。关闭议题会隐藏并保留它们，重新打开后再次显示。',
};
