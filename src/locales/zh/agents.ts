/** Chinese for the agents area: see index.ts for the terms. */
export const agents: Record<string, string> = {
  // src/lib/agentPage.ts — cards, the directory and the profile facts
  raised: '提出数',
  kept: '采纳率',
  rules: '规则',
  rule: '规则',
  'Record unavailable': '记录不可用',
  'Add it to a repository from its profile': '从它的个人资料页把它添加到仓库',
  'Reviews {repo}': '评审 {repo}',
  'Reviews {n} repositories': '评审 {n} 个仓库',
  'Wakes when Clef is {pct}% sure': 'Clef 有 {pct}% 把握时唤醒',
  'At least {pct}% sure that the answer is yes':
    '至少有 {pct}% 的把握认为答案是“是”',
  'A Pi agent that reads the repository with read-only tools':
    '一个用只读工具阅读仓库的 Pi Agent',
  'One reasoning-model pass per review': '每次评审运行一次推理模型',
  ', ': '、',
  'Added {names}.': '已添加 {names}。',
  '@{handle}: {reason}': '@{handle}：{reason}',
  'Give the agent a handle.': '请为这个 Agent 填写用户名。',
  'A handle can be at most 39 characters.': '用户名最多 39 个字符。',
  'Use letters, numbers and single hyphens only.':
    '只能使用字母、数字和单个连字符。',
  '{n} review': '{n} 条评审',
  '{n} reviews': '{n} 条评审',
  '{n} lesson': '{n} 条规则',
  '{n} lessons': '{n} 条规则',
  'Latest {items}': '最新 {items}',
  'All {items}': '全部 {items}',
  'Latest {shown} of {items}': '最新 {shown} 条，共 {items}',

  // src/lib/agentLook.ts — the status chips
  Passed: '通过',
  'Needs a person': '需要人工处理',
  'Changes requested': '已请求更改',
  Checking: '检查中',
  Working: '工作中',
  'Rule saved': '规则已保存',
  'Not needed': '不需要',
  'Off for this project': '在此项目中已关闭',
  'Review failed': '评审失败',
  Ready: '就绪',

  // src/lib/activityGrid.ts and components/agents/ActivityGrid.tsx
  Jan: '1月',
  Feb: '2月',
  Mar: '3月',
  Apr: '4月',
  May: '5月',
  Jun: '6月',
  Jul: '7月',
  Aug: '8月',
  Sep: '9月',
  Oct: '10月',
  Nov: '11月',
  Dec: '12月',
  Less: '少',
  More: '多',
  '{month} {day}: {reviews}': '{month} {day} 日：{reviews}',
  'no reviews': '没有评审',
  '{n} week': '{n} 周',
  '{n} weeks': '{n} 周',
  '{n} day': '{n} 天',
  '{n} days': '{n} 天',
  'No reviews': '没有评审',
  '{what} in the last {span}': '最近 {span}：{what}',

  // src/lib/lessons.ts — Rules learned
  Queued: '排队中',
  Learning: '学习中',
  Learned: '已学习',
  'Nothing to learn': '没有可学习的内容',
  Failed: '失败',
  'learned from {n} dismissed finding': '从 {n} 条已驳回的评审意见中学到',
  'learned from {n} dismissed findings': '从 {n} 条已驳回的评审意见中学到',
  '"{title}"': '“{title}”',
  'Dismissed {titles}': '已驳回 {titles}',
  'Dismissed findings': '已驳回的评审意见',
  'Nothing general to learn.': '没有可总结学习的内容。',
  'Failed.': '失败。',

  // src/components/AgentPrompt.tsx — the copy-paste prompt around the English body
  Prompt: '提示词',
  'Copy prompt': '复制提示词',
  'Paste into Claude Code or another coding agent.':
    '粘贴到 Claude Code 或其他编程 Agent 中。',
  'No command line needed. Paste this into {claude} or another coding agent, and it will copy your GitHub repository here — every branch, tag, and Git LFS file — then either keep it in sync with GitHub or switch your everyday work over.':
    '无需命令行。把这段内容粘贴到 {claude} 或其他编程 Agent 中，它会把你的 GitHub 仓库复制到这里——包括所有分支、标签和 Git LFS 文件——然后让你选择与 GitHub 保持同步，还是把日常工作切换到这里。',
  'No command line needed. Paste this into {claude} or another coding agent, and it will set up the repository on your computer, including Git LFS for large files, then help you make changes and open pull requests.':
    '无需命令行。把这段内容粘贴到 {claude} 或其他编程 Agent 中，它会在你的电脑上设置好仓库（大文件使用 Git LFS），然后帮你做修改并创建拉取请求。',

  // src/components/agents/AgentReadme.tsx
  'Its instructions are not available': '无法获取它的指令',
  'Its repository was deleted, or you can’t read it, so AGENT.md can’t be shown.':
    '它的仓库已被删除，或者你无法读取，因此无法显示 AGENT.md。',
  'Open repository': '打开仓库',
  'Loading AGENT.md': '正在加载 AGENT.md',
  'AGENT.md has no text yet': 'AGENT.md 还没有正文',
  'Add instructions below its settings and they show here.':
    '在设置下方添加指令，就会显示在这里。',

  // src/components/agents/AgentRecord.tsx
  Record: '记录',
  'its record': '它的记录',
  'findings raised': '提出的评审意见',
  'kept ({kept} kept, {dismissed} dismissed)':
    '保留比例（保留 {kept} 条，驳回 {dismissed} 条）',
  'rule learned': '学到的规则',
  'rules learned': '学到的规则',
  review: '评审',
  reviews: '评审',
  'Best catch.': '最佳发现。',
  Activity: '活动',
  'Reviews per day, UTC': '每天的评审数（UTC）',

  // src/components/agents/AgentTabs.tsx
  'No reviews yet': '还没有评审',
  'When Clef wakes it for a pull request in a repository you can see, the review shows up here.':
    '当 Clef 因为你能看到的仓库中的某个拉取请求唤醒它时，评审会显示在这里。',
  'No rules learned yet': '还没有学到规则',
  'When a person dismisses one of its change requests as wrong, it proposes a rule in its own repository, and it shows up here.':
    '当有人驳回它的某条更改请求并认为有误时，它会在自己的仓库中提出一条规则，并显示在这里。',
  '{rules} saved in all': '共保存 {rules}',
  'It saved a rule from this.': '它由此保存了一条规则。',
  'Saved in {sha}': '已保存在 {sha} 中',
  'How it wakes': '唤醒方式',
  'Where it is defined': '定义位置',
  'Clef asks this about every change, over a one-line summary of each changed file. When the answer is yes with enough probability, the agent reviews.':
    'Clef 会针对每个更改询问这个问题，依据是每个改动文件的一行摘要。当答案是“是”且把握足够大时，这个 Agent 就会评审。',
  'Clef asks': 'Clef 会问',
  'Wakes when': '唤醒条件',
  Engine: '引擎',
  Covers: '覆盖范围',
  'A custom area': '自定义领域',
  Guarded: '受保护',
  'Yes. Its findings are never approved in bulk, by one key or by GitOrange AI, and approving one needs a reason.':
    '是。它的评审意见永远不会被批量批准、一键批准或由 GitOrange AI 批准，批准其中一条需要填写理由。',
  No: '否',
  Colour: '颜色',
  Instructions: '指令',
  Version: '版本',
  'To change how it reviews, change AGENT.md in its repository. Edits are pull requests like any other.':
    '要改变它的评审方式，请修改它仓库中的 AGENT.md。修改和其他更改一样通过拉取请求进行。',
  'Its repository was deleted, or you can’t read it, so its settings can’t be shown.':
    '它的仓库已被删除，或者你无法读取，因此无法显示它的设置。',
  'AGENT.md has an error, so this shows its last valid version: {error}':
    'AGENT.md 有错误，因此这里显示它最后一个有效的版本：{error}',
  'Settings as written': '原始设置',
  'AGENT.md has no settings block.': 'AGENT.md 没有设置块。',

  // src/components/agents/WhereItReviews.tsx
  'Turned off {name} on {repo}': '已在 {repo} 上关闭 {name}',
  'Added {name} to {repo}': '已将 {name} 添加到 {repo}',
  'Where it reviews': '评审位置',
  '{n} repository': '{n} 个仓库',
  '{n} repositories': '{n} 个仓库',
  'It was removed from every repository': '它已从所有仓库中移除',
  'It is not on a repository you can see': '它不在你能看到的任何仓库中',
  'A deleted agent no longer reviews anything.':
    '已删除的 Agent 不再评审任何内容。',
  'Add it to a repository below, or from that repository’s settings. Until then it reviews nothing.':
    '在下方把它添加到仓库，或从仓库的设置中添加。在此之前它不会评审任何内容。',
  'Turn off': '关闭',
  'Turning off…': '正在关闭…',
  'Turn off {name} on {repo}': '在 {repo} 上关闭 {name}',
  '{name} is a guarded reviewer. With it off, changes here can merge without its review.':
    '{name} 是受保护的评审 Agent。关闭它后，这里的更改可以在没有它评审的情况下合并。',
  'Add {name} to a repository': '把 {name} 添加到仓库',
  'Add to a repository…': '添加到仓库…',
  'Adding…': '正在添加…',

  // src/pages/Agents.tsx
  'Manage agents': '管理 Agent',
  'Who can add reviewers': '谁能添加评审 Agent',
  'Reviewing your code': '正在评审你的代码',
  '{n} on repositories you can see': '在你能看到的仓库中有 {n} 个',
  'the agents': 'Agent 列表',
  'No reviewer is on a repository you can see':
    '你能看到的仓库中还没有评审 Agent',
  'Add the recommended crew, then invite each reviewer to a repository from its profile or from the repository’s settings.':
    '添加推荐的评审组，然后从每个评审 Agent 的个人资料或仓库设置中把它邀请到仓库。',
  'A reviewer starts once it is invited to a repository. Ask a site admin or the repository’s owner.':
    '评审 Agent 在被邀请到仓库后才会开始工作。请询问站点管理员或仓库所有者。',
  'Built in': '内置',
  'the built-in agents': '内置 Agent',
  'Every repository': '所有仓库',
  Available: '可用',
  'Open one to add it to a repository, or create the ones that are missing':
    '打开其中一个即可把它添加到仓库，或创建还缺少的那些',
  'Reviewers a site admin can add': '站点管理员可以添加的评审 Agent',
  'the reviewer presets': '评审 Agent 预设',
  'Not created yet': '尚未创建',
  'Create it from New reviewer': '在“新建评审 Agent”中创建',
  'Ask a site admin to create it': '请站点管理员创建',
  'No description yet.': '还没有简介。',
  'Not on a repository': '不在任何仓库中',
  'Its findings are never approved in bulk or by GitOrange AI, and approving one needs a reason':
    '它的评审意见永远不会被批量批准或由 GitOrange AI 批准，批准其中一条需要填写理由',
  'Each agent is an account with its own profile and its own repository of instructions. Reviewers check every change for one area; built-in agents keep changes moving.':
    '每个 Agent 都是一个账号，有自己的个人资料和自己的指令仓库。评审 Agent 负责检查某一领域的所有更改；内置 Agent 则让更改持续流转。',

  // src/pages/AgentNew.tsx
  'Created @{handle}. Add it to a repository to start.':
    '已创建 @{handle}。把它添加到仓库即可开始。',
  Created: '已创建',
  Recommended: '推荐',
  'What it looks at': '它关注什么',
  'Clef asks: {ask}': 'Clef 会问：{ask}',
  '{wake}. {engine}.': '{wake}。{engine}。',
  'Open profile': '打开个人资料',
  'Someone else already uses the handle @{handle}.':
    '其他人已经使用了用户名 @{handle}。',
  'Creating…': '正在创建…',
  'Create {name}': '创建 {name}',
  'A site admin can create this reviewer.':
    '站点管理员可以创建这个评审 Agent。',
  'The recommended crew is all here': '推荐的评审组已全部就位',
  'Start with the recommended crew': '从推荐的评审组开始',
  '{n} of the recommended crew is missing': '推荐的评审组中还缺 {n} 个',
  '{n} of the recommended crew are missing': '推荐的评审组中还缺 {n} 个',
  'Every recommended reviewer already exists. Invite them to a repository from their profiles.':
    '所有推荐的评审 Agent 都已存在。请从它们的个人资料中把它们邀请到仓库。',
  'Adds {names}, each with its own repository of instructions. Run it again later and it adds only the ones still missing.':
    '添加 {names}，每个都有自己的指令仓库。以后再运行一次时，只会添加仍然缺少的那些。',
  'Add the recommended crew': '添加推荐的评审组',
  'See the agents': '查看 Agent',
  'Nothing was added.': '没有添加任何内容。',
  'Skipped: {list}.': '已跳过：{list}。',
  '; ': '；',
  'See them on the Agents page.': '在 Agent 页面查看它们。',
  'Created {agent}. Edit AGENT.md in {repo} to say what it reviews, then invite it to a repository.':
    '已创建 {agent}。在 {repo} 中编辑 AGENT.md 以说明它评审什么，然后把它邀请到仓库。',
  'its repository': '它的仓库',
  Handle: '用户名',
  'Its username, and the name of its repository.':
    '它的用户名，也是它仓库的名称。',
  'Display name': '显示名称',
  'Creates {agent} and its repository {repo} with a starter AGENT.md (a general correctness reviewer), an avatar and a knowledge folder. You become a collaborator on it.':
    '创建 {agent} 及其仓库 {repo}，附带一份入门 AGENT.md（一个通用的正确性评审 Agent）、一个头像和一个知识文件夹。你会成为它的协作者。',
  'Create reviewer': '创建评审 Agent',
  'Its colour comes from its handle until AGENT.md names one. Changes to its instructions are pull requests like any other.':
    '在 AGENT.md 指定颜色之前，颜色由它的用户名决定。对它的指令的修改和其他更改一样通过拉取请求进行。',
  'Only site admins can create reviewers. Ask one of them to add the reviewer you need; once it exists you can read its profile here.':
    '只有站点管理员可以创建评审 Agent。请他们中的一位添加你需要的评审 Agent；它创建后，你可以在这里查看它的个人资料。',
  'the site admins': '站点管理员',
  'No site admin was found.': '没有找到站点管理员。',
  'A reviewer is an account with its own repository of instructions. Clef wakes it when a change concerns it.':
    '评审 Agent 是一个账号，有自己的指令仓库。当某个更改与它相关时，Clef 会唤醒它。',
  Presets: '预设',
  'Start blank': '从空白开始',

  // src/pages/AgentProfile.tsx
  Overview: '概览',
  Reviews: '评审',
  'Rules learned': '学到的规则',
  Configuration: '配置',
  'About {name}': '关于 {name}',
  'Deleted agent': '已删除的 Agent',
  'Defined in {repo}': '定义于 {repo}',
  'Its repository was deleted, or you can’t read it':
    '它的仓库已被删除，或者你无法读取',
  'Joined {when}': '加入于 {when}',
  '{name} sections': '{name} 的各个部分',
  'This agent was deleted. It is off every repository, and its past reviews keep its name.':
    '这个 Agent 已被删除。它已从所有仓库中关闭，过去的评审仍保留它的名字。',

  // src/pages/AgentBuiltin.tsx
  'Clef decides which reviewers and which tests a change concerns. It reads a one-line summary of each changed file, asks every invited reviewer’s question about the change, and wakes the ones whose answer is yes with enough probability.':
    'Clef 决定一个更改涉及哪些评审 Agent 和哪些测试。它阅读每个改动文件的一行摘要，就这个更改逐一回答每个受邀评审 Agent 提出的问题，并唤醒那些答案为“是”且把握足够的 Agent。',
  'When it is unsure, it wakes the reviewer: a reviewer that isn’t needed costs a little; one that is missed costs more.':
    '拿不准时，它会唤醒评审 Agent：多叫一个评审 Agent 代价很小，漏掉一个代价更大。',
  'Fixer untangles changes that collide. When the target branch moves, it rebases the pull request itself, one commit at a time, and resolves conflicts as it goes.':
    'Fixer 负责理清相互冲突的更改。当目标分支移动时，它会自己把拉取请求变基，一次一个提交，并在此过程中解决冲突。',
  'When it can’t combine the changes safely, it hands the pull request back to its author with both intents, rather than guessing.':
    '当无法安全地合并这些更改时，它会把两种意图都说明清楚，把拉取请求交还给作者，而不是靠猜测。',
  'this agent': '这个 Agent',
  'Built-in agent': '内置 Agent',
  'Works on every repository': '在所有仓库上工作',
  'Numbers cover the last seven days': '数据涵盖过去七天',
  'What it does': '它做什么',
  'Built into GitOrange. It has no account and no instruction repository; reviewers are the agents you can add and change. See {link}.':
    '内置于 GitOrange。它没有账号，也没有指令仓库；评审 Agent 是你可以添加和更改的那些 Agent。参见 {link}。',
  'all agents': '所有 Agent',
  'Last seven days': '过去七天',
  'Counts only repositories you can see.': '只统计你能看到的仓库。',
  // The seven presets' default names, bios and trigger questions (src/lib/agentLocale.ts).
  Security: '安全',
  'Makes sure nobody gets in who shouldn’t, and nothing leaks.':
    '确保不该进来的人进不来，也不会泄露任何东西。',
  'Could this change affect security: authentication, sessions, tokens, permissions or who can see what, user input reaching HTML, SQL, shell or URLs, secrets, file serving, or outbound requests?':
    '这个改动会影响安全吗：身份认证、会话、令牌、权限或谁能看到什么，用户输入进入 HTML、SQL、shell 或 URL，密钥，文件服务，或对外请求？',
  Data: '数据',
  'Makes sure your saved data survives every change.':
    '确保你保存的数据在每次改动后都完好无损。',
  'Does this change how data is stored: the database schema, a migration, what columns or JSON fields hold, or how existing rows are read or rewritten?':
    '这个改动会改变数据的存储方式吗：数据库结构、迁移、列或 JSON 字段存放的内容，或者已有数据的读取和改写方式？',
  Speed: '性能',
  'Watches how fast your app loads and answers.':
    '关注你的应用加载和响应有多快。',
  'Could this change make a page or request slower: queries, loops over data, bundle size, images or caching?':
    '这个改动会让页面或请求变慢吗：查询、遍历数据的循环、打包体积、图片或缓存？',
  Features: '功能',
  'Notices when something people use is removed or broken.':
    '发现大家在用的功能被移除或弄坏的情况。',
  'Does this change what people or agents can do with the product: remove, rename or change a page, route, API field, MCP tool, setting or behaviour, or add a new one?':
    '这个改动会改变人或 Agent 能用产品做的事吗：移除、重命名或修改页面、路由、API 字段、MCP 工具、设置或行为，或者新增一项？',
  Reliability: '可靠性',
  'Checks what happens when something goes wrong.': '检查出问题时会发生什么。',
  'Does this change how failures are handled: errors, retries, timeouts, queues or calls to other services?':
    '这个改动会改变故障的处理方式吗：错误、重试、超时、队列或对其他服务的调用？',
  Privacy: '隐私',
  'Keeps people’s personal details private.': '保护大家的个人信息不被泄露。',
  'Does this change collect, store, log, share or delete personal information about people?':
    '这个改动会收集、存储、记录、分享或删除个人信息吗？',
  Shipping: '发布',
  'Lists what must happen before a change goes live.':
    '列出改动上线前必须完成的事项。',
  'Will deploying this change need anything beyond a normal deploy: a migration, a new or changed binding, secret or environment variable, a dependency change, or a specific deploy order?':
    '部署这个改动是否需要常规部署以外的操作：迁移、新增或修改的绑定、密钥或环境变量、依赖变更，或特定的部署顺序？',
  'Reviews in': '评审语言',
  'The language of its next reviews: the summary, each finding and the questions for you':
    '它之后的评审所用的语言：评审结论、每条评审意见和问你的问题',
  'Reviews in {language}': '评审语言：{language}',
};
