import type { ApiCatalogSpec } from './api-types';

export const apiSpecZh: ApiCatalogSpec = {
  project: 'CloudForge · Git、REST OpenAPI、MCP 与 Actions 参考',
  subtitle:
    '覆盖部署于个人 Cloudflare 账户（Workers + D1 + Artifacts + R2 + Containers）的 OpenAPI /api/*、无状态 Streamable HTTP /mcp（31+3 工具）、Git HTTP/LFS、Webhooks 与 Actions 契约。',
  environments: [
    { label: '自部署 Workers 示例域', value: 'https://git.example.com' },
    { label: '本地全栈开发服务', value: 'http://localhost:8080' },
  ],
  searchPlaceholder: '搜索 /mcp、PAT/cfd_、Git LFS、Webhooks、Actions…',
  emptyText: '没有找到匹配的 CloudForge 接口或组件。',
  labels: {
    allGroups: '全部',
    canDo: '✅ 能做到',
    cannotDo: '⛔ 明确限制 / 拒绝条件',
    params: '参数、凭据域与硬限制',
    paramName: '参数 / 字段',
    paramLocation: '位置',
    paramType: '类型',
    paramRequired: '要求',
    paramDesc: '说明与平台上限',
    responses: '响应状态与安全拦截',
    examples: '标准调用示例',
    responseSample: '标准响应示例',
    copy: '复制',
    copied: '已复制',
    noParams: '无需额外请求参数。',
    required: '必填',
    optional: '可选',
    deepDocs: '查看完整接口与安全边界',
    totalItems: '组接口/组件',
    envLabel: '请求基址切换',
    mobilePicker: '切换接口或组件',
    defaultLabel: '默认',
    plainIndexToggle: '纯文本检索与打印索引（Ctrl+K 站内搜索定位）',
  },
  groups: [
    { id: 'rest-git', title: 'OpenAPI、Git HTTP 与 LFS' },
    { id: 'mcp-ci', title: 'OAuth 2.1 MCP、Actions 与 Webhook' },
    { id: 'ops', title: '官方安装器 CLI' },
  ],
  items: [
    {
      id: 'rest-openapi-live',
      group: 'rest-git',
      kind: 'GET',
      title: 'OpenAPI REST、实例探针与实时失效通道',
      signature: '/api/* · /api/doc · /.well-known/cloudforge · WSS /api/live',
      auth: 'D1 Session HMAC / PAT (部分路由)',
      stability: '核心平台接口',
      summary:
        '同源暴露 Zod OpenAPI 3.0（/api/doc、/api/swagger-ui）、better-auth 文档（/api/auth/reference）、零缓存实例健康探针 /.well-known/cloudforge 及轻量状态广播 WebSocket /api/live。',
      relatedLink: '/docs/apis-and-mcp',
      relatedLabel: '查看 REST 与 /api/live 明细',
      capabilities: [
        '对不可读私有仓库在 UI、REST、Search 与 Git/LFS 全入口一致返回 404 防枚举；邮箱仅管理员与本人可见',
        '高风险设置、协作者变更与 OIDC 绑定强制验证最近本地密码 + MFA 并使用代次 CAS 更新（冲突 409）',
      ],
      limitations: [
        '单租户一实例一组织：默认关闭公开自助注册；多团队成员关系与五级角色模型（rolePublishingAllowed: false）当前未开放',
        '/api/auth/* 请求体上限 64 KB，/api/* 常规体上限 1 MB；D1 单条 SQL 绑定参数硬上限 100 个',
      ],
      params: [
        {
          name: 'Authorization / Cookie',
          location: 'header',
          type: 'Bearer PAT / __Secure-session',
          required: false,
          description:
            'PAT 作用域取 min(成员权限, token_scope)；敏感更改须先完成本地 MFA 验证。',
        },
      ],
      responses: [
        {
          status: '200 OK (/.well-known/cloudforge)',
          tone: 'ok',
          summary: '返回实例运行时就绪态与 accessRuntime.ready 摘要',
          example: `{ "ok": true, "accessRuntime": { "ready": true, "rolePublishingAllowed": false } }`,
        },
        {
          status: '404 Not Found / 409 Conflict',
          tone: 'err',
          summary: '私有仓库越权读统一返 404；设置代次冲突返 409',
        },
      ],
      examples: [
        {
          label: '健康探针',
          lang: 'sh',
          code: `curl -sS "{{BASE_URL}}/.well-known/cloudforge"`,
        },
      ],
    },
    {
      id: 'git-http-lfs',
      group: 'rest-git',
      kind: 'POST',
      title: 'Git Smart HTTP、LFS Batch API 与 cfd_ 令牌',
      signature:
        'HTTPS /<owner>/<repo>.git · POST /<owner>/<repo>.git/info/lfs/objects/batch',
      auth: 'PAT 或单仓库部署令牌 cfd_ (禁用于 Web/MCP)',
      stability: 'Artifacts + R2 存储分离',
      summary:
        'Git 对象与引用写入 Cloudflare Artifacts，大二进制经 15 分钟有效 R2 预签名 URL 直传并验证 x-amz-checksum-sha256；提交状态 /statuses/{sha} 与 Actions 联合门控合并。',
      relatedLink: '/docs/contracts-and-boundaries',
      relatedLabel: '查看凭据矩阵与存储硬上限',
      capabilities: [
        '支持分支保护与 push_events Outbox 断点恢复；POST /api/repos/{owner}/{repo}/statuses/{sha} 支持千条状态（140 字摘要）触发自动落地',
      ],
      limitations: [
        '不支持 Git SSH（Workers 无法监听 22 端口）；不支持 Git LFS Locking 端点（返回空 / 501）',
        '新建 Artifacts 仓库上限 1 GB 且仅支持 Git 协议 v1；单仓库至多 50 把 cfd_ 令牌（1–366 天 TTL）',
      ],
      params: [
        {
          name: 'cfd_ Deploy Token',
          location: 'header',
          type: 'Basic / Bearer cfd_...',
          required: true,
          description:
            '绑定单一不可变 repository_id，每次请求复核创建者管理员身份；不可登录 Web/REST/MCP。',
        },
      ],
      responses: [
        {
          status: '200 OK (LFS Batch)',
          tone: 'ok',
          summary: '签发 15 分钟 R2 直传预签名 URL 与 sha256 校验头',
        },
        {
          status: '501 Not Implemented',
          tone: 'warn',
          summary: 'LFS 对象锁定接口明确不可用',
        },
      ],
      examples: [
        {
          label: '上报 Commit Status',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/api/repos/<owner>/<repo>/statuses/<sha>" \\
  -H "Authorization: Bearer <PAT>" \\
  -H "Content-Type: application/json" \\
  -d '{"state":"success","context":"ci/build","description":"All checks passed"}'`,
        },
      ],
    },
    {
      id: 'mcp-oauth-tools',
      group: 'mcp-ci',
      kind: 'MCP',
      title: '无状态 Streamable HTTP /mcp 与 OAuth 2.1',
      signature: 'POST /mcp (31 标准工具 + 3 Moderator 特权工具)',
      auth: 'OAuth 2.1 JWT (aud=<origin>/mcp, TTL 1h)',
      stability: '编码代理主接入',
      summary:
        '实现完整 RFC 9728 / 8414 / 7591 动态注册（默认回环端设为 native），暴露 31 项仓库/PR/Issue/Agent 工具；高危审批仅当用户在 Settings -> MCP server 显式提升为 moderator 后解锁。',
      relatedLink: '/docs/apis-and-mcp',
      relatedLabel: '查看 31+3 MCP 工具清清单',
      capabilities: [
        '支持透明兼容映射入站旧前缀 gitorange_* 调用，同时 tools/list 统一对外宣告 cloudforge_* 命名',
        '3 个 moderator 工具（approve_review_finding、dismiss_change_request、approve_pull_request）每次授权强制 prompt=consent 并核验 head SHA',
      ],
      limitations: [
        'POST /mcp 以外的 GET / DELETE 请求统一返回 405；请求体硬上限 1 MB；未提升权限的客户端直接屏蔽 3 项审批工具',
        '断开 MCP 客户端连接会立即吊销授权并中止后续调用',
      ],
      params: [
        {
          name: 'method / params',
          location: 'body',
          type: 'JSON-RPC 2.0 (<= 1 MB)',
          required: true,
          description: '支持 initialize、ping、tools/list 与 tools/call。',
        },
      ],
      responses: [
        { status: '200 OK', tone: 'ok', summary: '标准 MCP 工具结果' },
        {
          status: '403 / 405 Method Not Allowed',
          tone: 'err',
          summary: '未提权调用 moderator 工具或使用非 POST 访问 /mcp',
        },
      ],
      examples: [
        {
          label: 'tools/list 请求',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/mcp" \\
  -H "Authorization: Bearer <mcp_jwt>" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
        },
      ],
    },
    {
      id: 'actions-webhooks',
      group: 'mcp-ci',
      kind: 'CONFIG',
      title: '容器 Actions、Webhooks 与非目标范围',
      signature: '.github/workflows/*.yml · Webhooks (<= 20/repo)',
      auth: 'AES-GCM 密封密钥 + X-Hub-Signature-256',
      stability: 'CI 与出站事件',
      summary:
        '在 Cloudflare Containers（ubuntu-latest / cloudforge-standard-1..4）运行兼容子集与相关性跳测；出站 Webhooks（每仓至多 20 条）带 5 次退避重试并拦截内网 SSRF。',
      relatedLink: '/docs/contracts-and-boundaries',
      relatedLabel: '查看完整非目标清单与限制',
      capabilities: [
        '支持 on: push (含 tags)、pull_request、workflow_dispatch、GITHUB_EVENT_PATH 与 cloudforge/relevance@v1 智能跳测',
        'Webhook 同时附带 X-CloudForge-* 与 X-GitHub-* 签名头，10s 超时、禁重定向、2048 B 响应截断',
      ],
      limitations: [
        '明确不支持：Issue 里程碑/模板、跨仓引用 owner/repo#N、Webhook 按分支过滤、多 OIDC 并存、Passkey、SSH key 与全实例导出包',
        '出站 Webhook 严格拒绝 localhost、.local、.internal 及私有/保留 IP 字面量',
      ],
      params: [
        {
          name: 'events / secret / url',
          location: 'config',
          type: 'Webhook Config',
          required: true,
          description:
            '支持 push、pull_request、issues、issue_comment、release、status 与 ping。',
        },
      ],
      responses: [
        {
          status: 'Webhook 2xx (<= 2048 B)',
          tone: 'ok',
          summary: '失败按 1m / 5m / 30m / 2h 共 5 次调度重试',
        },
      ],
      examples: [
        {
          label: 'Actions 工作流子集',
          lang: 'yaml',
          code: `on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: cloudforge/relevance@v1`,
        },
      ],
    },
    {
      id: 'cli-installer',
      group: 'ops',
      kind: 'CLI',
      title: '零克隆部署、接管与离线恢复 CLI',
      signature: 'pnpm dlx @cybernova2333/cloudforge <command>',
      auth: 'Cloudflare API Token 或 wrangler login',
      stability: '官方运维命令行',
      summary:
        '无需克隆仓库即可在自有 Cloudflare 账户全自动创建 D1/R2/Artifacts、跑完 67 份迁移并部署；支持接管既有实例及不削弱 MFA 的审计级密码/MFA 重置。',
      relatedLink: '/docs/',
      relatedLabel: '查看部署命令与权限需求',
      capabilities: [
        '支持 install / upgrade / adopt / status 与 reset-password / reset-mfa 离线恢复命令',
      ],
      limitations: [
        '需要自有 Cloudflare 账户并具备 Workers、D1、R2、Artifacts 与 Containers 权限；不支持在他人多租户共享环境运行',
      ],
      params: [],
      responses: [
        {
          status: 'Exit 0',
          tone: 'ok',
          summary: '资源就绪并可直接访问 /setup 初始化管理员',
        },
      ],
      examples: [
        {
          label: '安装与接管示例',
          lang: 'sh',
          code: `pnpm dlx @cybernova2333/cloudforge install
pnpm dlx @cybernova2333/cloudforge status`,
        },
      ],
    },
  ],
};

export const apiSpecEn: ApiCatalogSpec = {
  project: 'CloudForge · Git, OpenAPI, MCP & Actions Reference',
  subtitle:
    'Interactive specification covering OpenAPI /api/* routes, Git Smart HTTP + R2 LFS Batch API, stateless OAuth 2.1 Streamable HTTP /mcp (31+3 tools), Webhooks, Containers CI, and installer CLIs.',
  environments: [
    { label: 'Self-Hosted Workers Domain', value: 'https://git.example.com' },
    { label: 'Local Dev Stack', value: 'http://localhost:8080' },
  ],
  searchPlaceholder: 'Filter /mcp, PAT/cfd_, Git LFS, Webhooks, Actions…',
  emptyText: 'No matching CloudForge endpoint or component found.',
  labels: {
    allGroups: 'All',
    canDo: '✅ Capabilities',
    cannotDo: '⛔ Explicit Limits / Rejections',
    params: 'Parameters, Credentials & Caps',
    paramName: 'Symbol / Field',
    paramLocation: 'Scope',
    paramType: 'Type',
    paramRequired: 'Rule',
    paramDesc: 'Description & Hard Limits',
    responses: 'Status & Security Guards',
    examples: 'Standard Invocation',
    responseSample: 'Sample Output / Receipt',
    copy: 'Copy',
    copied: 'Copied',
    noParams: 'No additional request parameters.',
    required: 'Required',
    optional: 'Optional',
    deepDocs: 'Open REST & MCP docs',
    totalItems: 'endpoint groups',
    envLabel: 'Base URL Environment',
    mobilePicker: 'Select Endpoint Group',
    defaultLabel: 'Default',
    plainIndexToggle: 'Plaintext Search & Print Index (Ctrl+K Target)',
  },
  groups: [
    { id: 'rest-git', title: 'OpenAPI, Git HTTP & LFS' },
    { id: 'mcp-ci', title: 'OAuth 2.1 MCP, Actions & Hooks' },
    { id: 'ops', title: 'Official Installer CLI' },
  ],
  items: [
    {
      id: 'rest-openapi-live',
      group: 'rest-git',
      kind: 'GET',
      title: 'OpenAPI REST, Health Probe & Live Invalidation',
      signature: '/api/* · /api/doc · /.well-known/cloudforge · WSS /api/live',
      auth: 'D1 Session HMAC / PAT',
      stability: 'Core API',
      summary:
        'Exposes OpenAPI 3.0 docs, better-auth docs, unauthenticated /.well-known/cloudforge readiness, and authenticated /api/live WebSocket invalidation pings.',
      relatedLink: '/en/docs/apis-and-mcp',
      relatedLabel: 'View full REST docs',
      capabilities: [
        'Uniform 404 masking across unreadable private repos; emails hidden from non-admin peers',
        'Enforces recent local password + MFA + conditional SQL generation CAS (409 on conflict) on high-risk settings',
      ],
      limitations: [
        'Single-tenant only (public signup disabled); 5-tier roles stay gated (rolePublishingAllowed: false)',
        '64 KB cap on /api/auth/* bodies, 1 MB on /api/*, and 100 max SQL bind params in D1',
      ],
      params: [
        {
          name: 'Authorization / Cookie',
          location: 'header',
          type: 'Bearer / HMAC',
          required: false,
          description:
            'PAT scopes clamp to min(member, token); high-risk ops require recent local MFA proof.',
        },
      ],
      responses: [
        {
          status: '200 OK / 404 / 409',
          tone: 'ok',
          summary: 'Runtime readiness and generation-guarded mutations',
          example: `{ "ok": true, "accessRuntime": { "ready": true, "rolePublishingAllowed": false } }`,
        },
      ],
      examples: [
        {
          label: 'curl',
          lang: 'sh',
          code: `curl -sS "{{BASE_URL}}/.well-known/cloudforge"`,
        },
      ],
    },
    {
      id: 'git-http-lfs',
      group: 'rest-git',
      kind: 'POST',
      title: 'Git Smart HTTP, LFS Batch API & cfd_ Deploy Tokens',
      signature: 'HTTPS /<owner>/<repo>.git · POST .../info/lfs/objects/batch',
      auth: 'PAT or Repo-Scoped cfd_ Token',
      stability: 'Artifacts + R2 Storage',
      summary:
        'Stores Git objects in Cloudflare Artifacts and streams LFS blobs directly to R2 via 15-min presigned URLs verified with x-amz-checksum-sha256.',
      relatedLink: '/en/docs/contracts-and-boundaries',
      relatedLabel: 'View token & storage limits',
      capabilities: [
        'Supports commit statuses (/statuses/{sha}) triggering auto-merge on success alongside Actions runs',
      ],
      limitations: [
        'No Git SSH (port 22 impossible on Workers); LFS lock endpoints return empty/501',
        '1 GB cap per newly created Artifacts repo (Git protocol v1); max 50 cfd_ tokens/repo (1–366d TTL)',
      ],
      params: [
        {
          name: 'cfd_ Deploy Token',
          location: 'header',
          type: 'Bearer cfd_...',
          required: true,
          description:
            'Immutable single-repo Git/LFS credential; blocked from Web/REST/MCP.',
        },
      ],
      responses: [
        {
          status: '200 OK (LFS Batch) / 501 (Lock)',
          tone: 'ok',
          summary: 'Issues 15-min R2 upload/download URLs',
        },
      ],
      examples: [
        {
          label: 'Commit Status API',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/api/repos/<owner>/<repo>/statuses/<sha>" -H "Authorization: Bearer <PAT>" -H "Content-Type: application/json" -d '{"state":"success","context":"ci/build"}'`,
        },
      ],
    },
    {
      id: 'mcp-oauth-tools',
      group: 'mcp-ci',
      kind: 'MCP',
      title: 'Stateless Streamable HTTP /mcp & OAuth 2.1',
      signature: 'POST /mcp (31 Standard + 3 Moderator Tools)',
      auth: 'OAuth 2.1 JWT (aud=<origin>/mcp, 1h TTL)',
      stability: 'Coding Agent Surface',
      summary:
        'Full RFC 9728/8414/7591 OAuth 2.1 server exposing 31 repo/PR/issue/agent tools plus 3 user-promoted moderator tools under forced consent and head-SHA checks.',
      relatedLink: '/en/docs/apis-and-mcp',
      relatedLabel: 'Inspect all 31+3 MCP tools',
      capabilities: [
        'Accepts legacy gitorange_* calls while advertising cloudforge_* in tools/list',
      ],
      limitations: [
        'GET/DELETE return 405; 1 MB body cap; moderator tools stay blocked unless explicitly enabled per client',
      ],
      params: [
        {
          name: 'method / params',
          location: 'body',
          type: 'JSON-RPC 2.0',
          required: true,
          description: 'initialize, ping, tools/list, tools/call.',
        },
      ],
      responses: [
        {
          status: '200 OK / 403 / 405',
          tone: 'ok',
          summary: 'Tool response or explicit method/moderator gate rejection',
        },
      ],
      examples: [
        {
          label: 'tools/list',
          lang: 'sh',
          code: `curl -sS -X POST "{{BASE_URL}}/mcp" -H "Authorization: Bearer <mcp_jwt>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
        },
      ],
    },
    {
      id: 'actions-webhooks',
      group: 'mcp-ci',
      kind: 'CONFIG',
      title: 'Container Actions, Webhooks & Non-Goals',
      signature: '.github/workflows/*.yml · Webhooks (<= 20/repo)',
      auth: 'AES-GCM Sealed Secrets + X-Hub-Signature-256',
      stability: 'CI & Event Outbox',
      summary:
        'Executes GitHub-compatible workflows on Cloudflare Containers alongside AES-GCM signed Webhooks (10s timeout, 2048 B cap, 5 backoff retries).',
      relatedLink: '/en/docs/contracts-and-boundaries',
      relatedLabel: 'Review full non-goals',
      capabilities: [
        'Supports push/tags, pull_request, workflow_dispatch, cloudforge-standard-1..4 containers, and cloudforge/relevance@v1',
      ],
      limitations: [
        'Excludes issue milestones/templates, cross-repo owner/repo#N, branch-filtered webhooks, multi-OIDC, Passkeys, SSH keys, cross-repo public forks, and bundle export',
        'Blocks webhooks pointing at localhost, .local, .internal, or private/reserved IP literals',
      ],
      params: [
        {
          name: 'events / url / secret',
          location: 'config',
          type: 'Webhook spec',
          required: true,
          description: 'Up to 20 webhooks per repository across 7 event types.',
        },
      ],
      responses: [
        {
          status: 'Webhook 2xx (<= 2048 B)',
          tone: 'ok',
          summary: 'Retries 5 times (1m / 5m / 30m / 2h) via cron',
        },
      ],
      examples: [
        {
          label: 'Workflow YAML',
          lang: 'yaml',
          code: `on: [push, pull_request]\njobs:\n  ci:\n    runs-on: ubuntu-latest`,
        },
      ],
    },
    {
      id: 'cli-installer',
      group: 'ops',
      kind: 'CLI',
      title: 'Zero-Clone Deploy, Adopt & Offline Recovery CLI',
      signature:
        'pnpm dlx @cybernova2333/cloudforge install | upgrade | adopt | status',
      auth: 'Scoped Cloudflare API Token / wrangler login',
      stability: 'Official Admin CLI',
      summary:
        'Provisions D1/R2/Artifacts, applies 67 migrations, adopts manual installs, and resets passwords/MFA with audit logs without weakening policy.',
      relatedLink: '/en/docs/',
      relatedLabel: 'View provisioning guide',
      capabilities: [
        'Full lifecycle install, upgrade, adopt, status, and reset-password/reset-mfa commands',
      ],
      limitations: [
        'Targets your own single-tenant Cloudflare account with required resource scopes',
      ],
      params: [],
      responses: [
        {
          status: 'Exit 0',
          tone: 'ok',
          summary: 'Worker live and ready for initial /setup admin',
        },
      ],
      examples: [
        {
          label: 'Install & Status',
          lang: 'sh',
          code: `pnpm dlx @cybernova2333/cloudforge install\npnpm dlx @cybernova2333/cloudforge status`,
        },
      ],
    },
  ],
};
