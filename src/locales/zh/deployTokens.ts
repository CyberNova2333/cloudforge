/** Repository-scoped HTTPS deploy credentials. */
export const deployTokens: Record<string, string> = {
  'Deploy tokens': '部署令牌',
  'Give a deployment machine HTTPS access to this repository only.':
    '为部署机器授予仅限此仓库的 HTTPS 访问权限。',
  'Repository deploy tokens': '仓库部署令牌',
  'For Git and Git LFS only. Tokens cannot sign in or call REST or MCP APIs.':
    '仅供 Git 和 Git LFS 使用。部署令牌不能登录网页或调用 REST、MCP 接口。',
  'Deploy tokens did not load': '部署令牌加载失败',
  'No deploy tokens yet': '还没有部署令牌',
  'Create a read-only token for a machine that only needs to fetch code.':
    '只需拉取代码的机器应使用只读令牌。',
  'New deploy token': '新部署令牌',
  'Your new deploy token': '你的新部署令牌',
  'It is only shown once. Store it in your credential manager.':
    '令牌只显示这一次，请保存到凭据管理器。',
  'I have saved the token': '我已保存令牌',
  'Create deploy token': '创建部署令牌',
  'This repository has 50 deploy tokens. Revoke an unused or expired token first.':
    '此仓库已有 50 个部署令牌，请先撤销不用或已过期的令牌。',
  'For example: production deploy machine': '例如：生产环境部署机器',
  'Expires in days': '有效天数',
  '1–366 days. Default: 30 days.': '1–366 天，默认 30 天。',
  'A write token can push workflows that use this repository’s Actions secrets. It cannot push the default or protected branches. An admin must initialize the default branch first.':
    '可写令牌能推送使用此仓库 Actions 密钥的工作流。它不能推送默认分支或受保护分支，使用前须由管理员初始化默认分支。',
  'Using deploy tokens': '使用部署令牌',
  'Use the normal HTTPS clone URL. Enter deploy as the username and the token as the password; Git LFS uses the same credentials. Keep the token out of the URL.':
    '使用普通的 HTTPS 克隆地址，用户名填 deploy，密码填部署令牌；Git LFS 使用相同凭据。不要把令牌放进 URL。',
  'Tokens work while their creator remains an active repository admin. Revoke a token to disable it permanently.':
    '令牌创建者必须保持有效的仓库管理员身份。要永久停用令牌，请撤销它。',
  'Revocation blocks new Git and LFS requests. Transfers already started and previously signed LFS links can remain valid; LFS links expire within 15 minutes.':
    '撤销会阻止新的 Git 和 LFS 请求。已开始的传输及已签发的 LFS 链接可能继续有效；LFS 链接最长 15 分钟后失效。',
  'Revoke deploy token {name}': '撤销部署令牌 {name}',
  'Revoke token': '撤销令牌',
  Revoke: '撤销',
  'Revoking…': '撤销中…',
  'Only repository admins can manage deploy tokens':
    '只有仓库管理员能管理部署令牌',
  'Deploy token not found': '部署令牌不存在',
  'A repository can have at most 50 deploy tokens. Revoke unused tokens first.':
    '每个仓库最多保留 50 个部署令牌，请先撤销不用的令牌。',
  ' created the deploy token “': '创建了部署令牌“',
  ' revoked the deploy token “': '撤销了部署令牌“',
  ' pushed with deploy token “{token}”': '使用部署令牌“{token}”推送了代码',
};
