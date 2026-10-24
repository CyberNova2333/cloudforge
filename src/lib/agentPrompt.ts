// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { lang, type Lang } from './i18n';
import type { RepoDetail } from './uiApi';

/**
 * Prompt for a coding agent to work on a repository, in the UI language (the agent then talks to the person in
 * it). The person runs the clone themselves so the token goes to git's credential store, never to the agent.
 */
export function agentPrompt(
  repo: RepoDetail,
  origin = window.location.origin,
  appName = 'CloudForge',
  language: Lang = lang
): string {
  const web = `${origin}/${repo.fullName}`;
  const tokens = `${origin}/settings/tokens`;
  const branch = repo.defaultBranch;
  if (language === 'zh') {
    const start = repo.empty
      ? `5. 这个仓库是空的。帮我添加第一批文件（至少要有一个说明项目是什么的 README.md），提交到 \`${branch}\` 分支并推送。`
      : `5. 用通俗的话告诉我仓库里有什么，然后问我想改什么。`;
    return `你在帮我处理托管在我们团队 ${appName} 服务器（一个自建的、类似 GitHub 的网站）上的 Git 仓库。我不是开发者，每做一步之前，请先用通俗的中文解释你要做什么。

仓库：${repo.cloneUrl}
网页：${web}

1. 检查是否装好了 git 和 Git LFS（\`git --version\` 和 \`git lfs version\`）。缺哪个，就告诉我在我的电脑上怎么安装，然后等我装好。
2. 运行 \`git lfs install\`（每台电脑只需一次）。
3. 仓库由我自己克隆，这样我的访问令牌永远不会出现在这段对话里。请让我在输入框里输入下面这行（包括开头的「!」）：
   ! git clone ${repo.cloneUrl}
   git 询问时，用户名是我的 ${appName} 用户名，密码是个人访问令牌，可以在 ${tokens} 创建。之后我的电脑会记住它。
4. 在克隆下来的文件夹里，确保大文件走 Git LFS：对我常用的文件类型运行 \`git lfs track\`（例如 "*.psd" "*.ai" "*.zip" "*.mp4" "*.mov" "*.pdf" "*.png" "*.jpg"），并提交生成的 .gitattributes 文件。
${start}

之后：
- 提交前先总结改了什么，并和我确认。提交信息要简短清楚。
- 每项修改都在新分支上进行，推送后给我这个创建拉取请求的链接：${web}/compare/${branch}...<分支名>
- 如果你连接了 ${appName} 的工具（它的 MCP 服务器），就直接用 \`cloudforge_create_pull_request\` 创建拉取请求，不必给我链接，并且始终传入 \`request\`（我最初请你做的事，用我自己的原话）和 \`session\`（这次工作会话的简短标签，例如 "s1"，本次会话中创建的每个拉取请求都用同一个）。评审的人靠这些了解这项修改为什么存在。
- 开始新工作前先拉取最新改动。
- 不要强制推送，不要删除分支，也不要提交密码、令牌或其他机密信息。`;
  }
  const start = repo.empty
    ? `5. This repository is empty. Help me add my first files (at least a README.md that says what the project is), commit them on the \`${branch}\` branch, and push.`
    : `5. Show me what's in the repository in plain language, then ask what I'd like to change.`;
  return `You're helping me work on a Git repository hosted on our team's ${appName} server (a self-hosted, GitHub-style site). I'm not a developer, so explain each step in plain language before you do it.

Repository: ${repo.cloneUrl}
Web page: ${web}

1. Check that git and Git LFS are installed (\`git --version\` and \`git lfs version\`). If either is missing, tell me how to install it on my computer and wait for me.
2. Run \`git lfs install\` (once per computer).
3. I'll clone the repository myself, so my access token never appears in this chat. Ask me to type this into the prompt, including the leading "!":
   ! git clone ${repo.cloneUrl}
   When git asks, my username is my ${appName} username, and the password is a personal access token, which I can create at ${tokens}. My computer will remember it after this.
4. In the cloned folder, make sure large files go through Git LFS: run \`git lfs track\` for the kinds of files I work with (for example "*.psd" "*.ai" "*.zip" "*.mp4" "*.mov" "*.pdf" "*.png" "*.jpg"), and commit the resulting .gitattributes file.
${start}

From then on:
- Before committing, summarize what changed and confirm with me. Use short, clear commit messages.
- Make each change on a new branch, push it, and give me this link to open a pull request: ${web}/compare/${branch}...<branch-name>
- If you're connected to ${appName}'s tools (its MCP server), open the pull request yourself with \`cloudforge_create_pull_request\` instead of giving me a link, and always pass \`request\` (what I originally asked you for, in my own words) and \`session\` (a short label for this working session, such as "s1", the same for every pull request you open in it). That's how the people reviewing see why the change exists.
- Pull the latest changes before starting new work.
- Never force-push, never delete branches, and never commit passwords, tokens, or other secrets.`;
}

/**
 * Prompt for migrating a GitHub repository (branches, tags, LFS) into an empty one, in the UI language. The
 * person runs every command that needs a password, so no token passes through the agent.
 */
export function importFromGitHubPrompt(
  repo: RepoDetail,
  origin = window.location.origin,
  appName = 'CloudForge',
  language: Lang = lang
): string {
  const web = `${origin}/${repo.fullName}`;
  const url = repo.cloneUrl;
  const mirror = `${repo.name}-github.git`;
  if (language === 'zh')
    return `你在帮我把一个 Git 仓库从 GitHub 迁移到我们团队的 ${appName} 服务器（一个自建的、类似 GitHub 的网站）。我不是开发者，每做一步之前，请先用通俗的中文解释你要做什么。

目标（一个空的 ${appName} 仓库）：${url}
它的网页：${web}

1. 检查是否装好了 git 和 Git LFS（\`git --version\` 和 \`git lfs version\`）。缺哪个，就告诉我在我的电脑上怎么安装，然后等我装好。之后运行 \`git lfs install\`。
2. 问我 GitHub 仓库的地址（形如 https://github.com/OWNER/REPO）。
3. 仓库由我自己下载，这样我的 GitHub 密码永远不会出现在这段对话里。请让我在输入框里输入下面这行（包括开头的「!」，并填好地址）：
   ! git clone --mirror <GitHub 地址> ${mirror}
   如果是私有仓库，git 会要我的 GitHub 用户名，密码填 GitHub 个人访问令牌。
4. 从 GitHub 取回所有 Git LFS 文件：\`git -C ${mirror} lfs fetch --all\`。仓库没用 Git LFS 也没关系，跳过即可。
5. 第一次上传也由我自己来，这样我的 ${appName} 密码同样不会出现在这段对话里。请让我运行：
   ! git -C ${mirror} push --all ${url}
   git 询问时，用户名是我的 ${appName} 用户名，密码是个人访问令牌，可以在 ${origin}/settings/tokens 创建。之后我的电脑会记住它。
6. 然后由你推送标签和 Git LFS 文件：\`git -C ${mirror} push --tags ${url}\` 和 \`git -C ${mirror} lfs push --all ${url}\`。
7. 检查有没有遗漏：对比 \`git -C ${mirror} branch --list\` 和 \`git ls-remote --heads ${url}\`，用通俗的话告诉我结果。如果默认分支不是我想要的，提醒我可以在 ${web}/settings 修改。

然后问我想要哪一种：
- 暂时仍以 GitHub 上的为主，定期同步到这里。如果选这个，在 ${mirror} 文件夹里写一个名为 sync-from-github 的小脚本，依次运行 \`git fetch --prune origin\`、\`git lfs fetch --all origin\`、\`git push --all ${url}\`、\`git push --tags ${url}\` 和 \`git lfs push --all ${url}\`，并教我怎么运行。这些都是普通推送（不强制），所以如果这期间有人改了这里的分支，脚本会停下来，我会来找你帮忙，而不会丢失任何工作。
- 日常工作改用 ${appName}。如果选这个，在我现有的项目工作副本里把远程地址改到这台服务器（\`git remote set-url origin ${url}\`），之后每项修改都在新分支上进行，推送后给我在 ${web}/compare 创建拉取请求的链接。

不要强制推送，不要删除任何一台服务器上的分支，也不要提交密码、令牌或其他机密信息。`;
  return `You're helping me move a Git repository from GitHub to our team's ${appName} server (a self-hosted, GitHub-style site). I'm not a developer, so explain each step in plain language before you do it.

Destination (an empty ${appName} repository): ${url}
Its web page: ${web}

1. Check that git and Git LFS are installed (\`git --version\` and \`git lfs version\`). If either is missing, tell me how to install it on my computer and wait for me. Then run \`git lfs install\`.
2. Ask me for the GitHub repository's address (it looks like https://github.com/OWNER/REPO).
3. I'll download it myself, so my GitHub password never appears in this chat. Ask me to type this into the prompt, including the leading "!", with the address filled in:
   ! git clone --mirror <GitHub address> ${mirror}
   If the repository is private, git will ask for my GitHub username and a GitHub personal access token as the password.
4. Fetch every Git LFS file from GitHub: \`git -C ${mirror} lfs fetch --all\`. If the repository doesn't use Git LFS, that's fine; skip ahead.
5. I'll upload it myself the first time, so my ${appName} password never appears in this chat either. Ask me to run:
   ! git -C ${mirror} push --all ${url}
   When git asks, my username is my ${appName} username, and the password is a personal access token I can create at ${origin}/settings/tokens. My computer will remember it after this.
6. Then push the tags and the Git LFS files yourself: \`git -C ${mirror} push --tags ${url}\` and \`git -C ${mirror} lfs push --all ${url}\`.
7. Check that nothing was missed: compare \`git -C ${mirror} branch --list\` with \`git ls-remote --heads ${url}\`, and tell me the result in plain language. Remind me I can change the default branch at ${web}/settings if it isn't the one I expect.

Then ask me which of these I want:
- Keep the GitHub copy as the main one for now, and sync it here regularly. If so, write a small script called sync-from-github in the ${mirror} folder that runs \`git fetch --prune origin\`, \`git lfs fetch --all origin\`, \`git push --all ${url}\`, \`git push --tags ${url}\`, and \`git lfs push --all ${url}\`, and show me how to run it. Pushes are normal (not forced), so if someone changed a branch here in the meantime, the script stops and I'll ask you for help instead of losing work.
- Switch to ${appName} for everyday work. If so, in my existing working copy of the project, change the remote to this server (\`git remote set-url origin ${url}\`), and from then on make each change on a new branch, push it, and give me the link to open a pull request at ${web}/compare.

Never force-push, never delete branches on either server, and never commit passwords, tokens, or other secrets.`;
}
