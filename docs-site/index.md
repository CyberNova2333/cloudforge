---
layout: home
repoGuideSource: 'repo-docs/README.md'

hero:
  name: CloudForge
  text: 单租户自托管边缘代码协作平台
  tagline: 构建在 Cloudflare Workers + D1 + Artifacts 之上，极速、私密、免运维的轻量代码托管与协作系统。
  actions:
    - theme: brand
      text: 开启文档阅读
      link: /walkthroughs/one-real-run
    - theme: alt
      text: 架构代码地图
      link: /code-map
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/CyberNova2333/cloudforge

features:
  - title: 纯 Serverless 边缘架构
    details: 后端核心由 Cloudflare Workers 驱动，持久化依托 SQLite D1 与 R2 存储桶，具备全球极低访问延迟。
  - title: 完整 Git 与协作流程
    details: 支持标准 Git HTTP 协议克隆/拉取/推送，内置 Issue 任务追踪、Pull Request 代码评审与权限隔离。
  - title: 零基础设施运维负担
    details: 单租户开箱即用，无需维护虚拟主机、Docker 守护进程或复杂备份脚本，数据随 Cloudflare 原生加密备份。
---

## 这是什么

**CloudForge** 是一个面向独立开发者与小型研发团队的单租户自托管代码协作平台。

不同于庞大复杂的 GitLab 或 Gitea，CloudForge 充分利用现代边缘云基础设施（Cloudflare Workers + D1 数据库 + R2 对象存储），打造了一个在启动成本、维护开销和数据隐私之间取得极致平衡的代码托管与审查中枢。

## 架构全景

<div class="archify-diagram-card" style="margin: 1.5rem 0; border: 1px solid var(--vp-c-border); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px; background: var(--vp-c-bg-elv); border-bottom: 1px solid var(--vp-c-border); font-size: 13px;">
    <span style="font-weight: 600; color: var(--vp-c-text-1); display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">📐</span> 云函数编排与边缘部署架构（交互式架构图表，支持平移 / 缩放 / 探查）
    </span>
    <a href="/diagrams/cloudforge-architecture.html" target="_blank" rel="noreferrer" style="font-size: 12px; color: var(--vp-c-brand-1); text-decoration: none; font-weight: 500;">
      在新窗口全屏打开 ↗
    </a>
  </div>
  <iframe src="/diagrams/cloudforge-architecture.html" width="100%" height="520px" frameborder="0" style="display: block; border: none;" allowfullscreen loading="lazy"></iframe>
</div>

## 怎么用 / 快速上手

### 1. 本地构建与验证

Node.js 22+ 与 pnpm 环境：

```bash
# 安装依赖
pnpm install

# 运行全套单元与协议契约测试
pnpm test
```

### 2. 部署到 Cloudflare

配置 `wrangler.toml` 后一键推向边缘网络：

```bash
# 创建 D1 数据库实例并执行迁移
npx wrangler d1 migrations apply DB --remote

# 部署 Worker
pnpm run deploy
```

## 分层阅读与快速跳转

::: tip 按读者角色快速检索

- **初次接触 / 快速上手**：从[一次真实主流程](/walkthroughs/one-real-run)开始，追踪一个代码推送与 PR 创建事件在 Workers 与 D1 之间的流动。
- **架构设计 / 存储拓扑**：从[代码地图](/code-map)进入，查阅 Git 协议解析器、D1 数据迁移与鉴权中间件设计。
- **审计复核 / 核心贡献**：从[源码证据](/references/source-evidence)核对真实测试基准与回执，查阅[文档质量复核](/references/quality-review)了解未覆盖区域。
  :::

---

## 完整项目指南概览

<!--@include: ../repo-docs/README.md-->
