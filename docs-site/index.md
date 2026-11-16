---
layout: home

hero:
  name: CloudForge
  text: 自托管在 Cloudflare 上的代码平台
  tagline: 单租户、零常驻服务器运维：在一个 Worker 内提供 React 网页、Git HTTPS/LFS、容器 CI、PR 堆叠、AI 代码审查与 OAuth 2.1 MCP。
  actions:
    - theme: brand
      text: 起步与部署
      link: /docs/
    - theme: alt
      text: 交互式架构全景
      link: /docs/architecture
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/CyberNova2333/cloudforge

features:
  - title: Edge Git 与 R2 LFS 存储分离
    details: 仓库对象与引用托管在 Cloudflare Artifacts，大二进制经 15 分钟 R2 预签名 URL 直传；Worker 在入口层统一校验令牌权限与引用保护。
  - title: AI 审查、PR 堆叠与自动落地
    details: '支持单轮 Pass 与 AgentReviewer 沙箱深度审查（engine: pi），自动识别 PR 依赖图并通过 CAS 变基快进安全合并。'
  - title: 容器 Actions 与 OAuth 2.1 MCP
    details: 在 Cloudflare Containers 上按需运行 GitHub 兼容工作流，同时向外部编码代理暴露带权限隔离与 moderator 审计的 /mcp 接口。
---

## 架构全景图

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📐</span> CloudForge 边缘架构与核心组件关系（交互式 Archify 图表，支持平移、缩放与节点探查）
    </span>
    <a href="/diagrams/cloudforge-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      在新窗口全屏打开 ↗
    </a>
  </div>
  <iframe src="/diagrams/cloudforge-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

## 最快上手路径

```bash
# 向自己的 Cloudflare 账户安装或升级单租户实例（无需克隆仓库）
pnpm dlx @cybernova2333/cloudforge install

# 或克隆源码并在本地启动全栈开发服务（默认 http://localhost:8080）
pnpm install --frozen-lockfile && pnpm dev
```

## 文档分层导航

::: tip 按照读者需求快速跳转

- **初次评估与云端自部署**：阅读 [项目概览与边界](/docs/) 与 [多模式部署与运维](/docs/deployment)，明确单租户定位、平台上限，并通过 CLI 安装器或手工 `wrangler.jsonc` 完成部署；
- **运维配置、绑定与故障排查**：查阅 [绑定、变量与实例设置](/docs/configuration) 与 [排错 FAQ](/docs/faq)，对照全部 Workers 绑定、Cron、密钥以及 `reset-mfa` / 503 排错路径；
- **集成 MCP、Webhook、Actions 或编写审查 Agent**：查阅 [API、MCP、Webhooks 与 Actions](/docs/apis-and-mcp) 与 [跨模块协同与扩展](/docs/interactions-and-extensibility)，获取 `/mcp` 工具契约与 `AGENT.md` 规范；
- **深入源码实现与版本迁移**：查阅 [系统架构](/docs/architecture)、[一次真实主流程](/docs/walkthrough)、[源码地图](/docs/code-map) 与 [数据库迁移、升级门禁与 ADR](/docs/changelog-and-migrations)。
  :::
