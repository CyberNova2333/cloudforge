import { defineConfig } from 'vitepress';
import { guideLinks } from './guide-links.mts';

const guidePageRoutes: Record<string, string> = {
  'README.md': 'docs/walkthrough',
  'walkthroughs/one-real-run.md': 'docs/walkthrough',
  'code-map.md': 'docs/code-map',
  'glossary.md': 'docs/glossary',
  'modules/git-and-storage.md': 'docs/modules/git-and-storage',
  'modules/reviews-stacking-and-merge.md':
    'docs/modules/reviews-stacking-and-merge',
  'modules/actions-containers-and-webhooks.md':
    'docs/modules/actions-containers-and-webhooks',
  'modules/auth-oidc-and-access.md': 'docs/modules/auth-oidc-and-access',
  'references/source-evidence.md': 'docs/code-map#源码证据与验证入口',
  'references/quality-review.md': 'docs/code-map#源码证据与验证入口',
  'change-log.md': 'docs/changelog-and-migrations',
};

export default defineConfig({
  cleanUrls: true,
  markdown: {
    config(md) {
      md.use(guideLinks(guidePageRoutes));
    },
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'CloudForge 官方文档',
      description:
        '自托管在 Cloudflare Workers、D1、Artifacts、R2 与 Containers 上的单租户 Git 协作与 AI 代码审查平台。',
      themeConfig: {
        siteTitle: 'CloudForge',
        nav: [
          { text: '首页', link: '/' },
          { text: '起步与部署', link: '/docs/' },
          { text: '契约与扩展', link: '/docs/contracts-and-boundaries' },
          { text: '架构与内核', link: '/docs/architecture' },
          { text: '变更与迁移', link: '/docs/changelog-and-migrations' },
          {
            text: 'GitHub',
            link: 'https://github.com/CyberNova2333/cloudforge',
          },
        ],
        sidebar: [
          {
            text: '起步与部署',
            items: [
              { text: '项目概览与边界', link: '/docs/' },
              { text: '多模式部署与运维', link: '/docs/deployment' },
              { text: '绑定、变量与实例设置', link: '/docs/configuration' },
              { text: '部署与运行排错 FAQ', link: '/docs/faq' },
            ],
          },
          {
            text: '契约与扩展',
            items: [
              {
                text: '权限模型与安全边界',
                link: '/docs/contracts-and-boundaries',
              },
              {
                text: 'API、MCP、Webhooks 与 Actions',
                link: '/docs/apis-and-mcp',
              },
              {
                text: '跨模块协同、Agent 编写与国际化',
                link: '/docs/interactions-and-extensibility',
              },
            ],
          },
          {
            text: '架构与内核原理',
            items: [
              { text: '系统架构与交互拓扑', link: '/docs/architecture' },
              { text: '一次真实推送主流程', link: '/docs/walkthrough' },
              {
                text: 'Git、Artifacts 与 LFS 存储',
                link: '/docs/modules/git-and-storage',
              },
              {
                text: 'AI 审查、堆叠与自动落地',
                link: '/docs/modules/reviews-stacking-and-merge',
              },
              {
                text: 'Actions 容器、状态与 Webhooks',
                link: '/docs/modules/actions-containers-and-webhooks',
              },
              {
                text: '认证、OIDC 与访问兼容内核',
                link: '/docs/modules/auth-oidc-and-access',
              },
              { text: '源码地图与贡献流程', link: '/docs/code-map' },
              { text: '术语表', link: '/docs/glossary' },
            ],
          },
          {
            text: '版本变更与迁移',
            items: [
              {
                text: '数据库迁移、升级门禁与 ADR',
                link: '/docs/changelog-and-migrations',
              },
            ],
          },
        ],
        outline: { level: [2, 3], label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'CloudForge Documentation',
      description:
        'Single-tenant Git hosting, container CI, stacked PRs, and AI code review running on your own Cloudflare account.',
      themeConfig: {
        siteTitle: 'CloudForge',
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Deploy', link: '/en/docs/' },
          { text: 'Contracts', link: '/en/docs/contracts-and-boundaries' },
          { text: 'Architecture', link: '/en/docs/architecture' },
          { text: 'Migrations', link: '/en/docs/changelog-and-migrations' },
          {
            text: 'GitHub',
            link: 'https://github.com/CyberNova2333/cloudforge',
          },
        ],
        sidebar: [
          {
            text: 'Getting Started & Deployment',
            items: [
              { text: 'Overview & Scope Boundaries', link: '/en/docs/' },
              {
                text: 'Deployment Modes & Operations',
                link: '/en/docs/deployment',
              },
              {
                text: 'Bindings, Vars & Instance Settings',
                link: '/en/docs/configuration',
              },
              { text: 'Troubleshooting FAQ', link: '/en/docs/faq' },
            ],
          },
          {
            text: 'Contracts & Extensibility',
            items: [
              {
                text: 'Access Model & Security Boundaries',
                link: '/en/docs/contracts-and-boundaries',
              },
              {
                text: 'REST, MCP, Webhooks & Actions',
                link: '/en/docs/apis-and-mcp',
              },
              {
                text: 'Flows, AGENT.md & UI i18n',
                link: '/en/docs/interactions-and-extensibility',
              },
            ],
          },
          {
            text: 'Architecture & Internals',
            items: [
              {
                text: 'System Architecture & Diagram',
                link: '/en/docs/architecture',
              },
              { text: 'End-to-End Walkthrough', link: '/en/docs/walkthrough' },
              {
                text: 'Git, Artifacts & R2 LFS',
                link: '/en/docs/modules/git-and-storage',
              },
              {
                text: 'Reviews, Stacking & Auto-Merge',
                link: '/en/docs/modules/reviews-stacking-and-merge',
              },
              {
                text: 'Actions Containers & Webhooks',
                link: '/en/docs/modules/actions-containers-and-webhooks',
              },
              {
                text: 'Auth, OIDC & Access Runtime',
                link: '/en/docs/modules/auth-oidc-and-access',
              },
              { text: 'Code Map & Contributing', link: '/en/docs/code-map' },
              { text: 'Glossary', link: '/en/docs/glossary' },
            ],
          },
          {
            text: 'Releases & Migrations',
            items: [
              {
                text: 'Migrations, Upgrade Gates & ADRs',
                link: '/en/docs/changelog-and-migrations',
              },
            ],
          },
        ],
        outline: { level: [2, 3], label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
      },
    },
  },
  themeConfig: {
    search: { provider: 'local' },
  },
});
