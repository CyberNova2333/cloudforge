<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# CloudForge 源码阅读指南

成员向仓库推送一条分支时，平台必须同时守住仓库权限、Git 引用保护和后续任务的可恢复性。本指南沿这次推送解释代码托管的一条主路径，帮助维护者区分“对象已写入”和“后续处理已完成”。

## 阅读路径

| 读者目标            | 从这里开始                                                    | 读完后获得什么                                                               |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 理解一次真实运行    | [主流程与拒绝边界](walkthroughs/one-real-run.md)              | 能解释输入、交接和结果，知道失败在哪里出现                                   |
| 定位修改入口        | [按职责找代码](code-map.md)                                   | 在已声明范围内找到入口、依赖和验证位置                                       |
| 审核解释依据        | [源码证据与两遍调查](references/source-evidence.md)           | 区分直接证据、范围限制和未执行验证                                           |
| 复核文档质量        | [读者模拟与剩余风险](references/quality-review.md)            | 看懂本指南能回答什么，哪些问题仍需验证                                       |
| 查看同步边界        | [指南变更记录](change-log.md)                                 | 找到源码锚点与本轮验证范围                                                   |
| 理解强制 MFA 与恢复 | [管理员认证策略](../docs/authentication.md#管理员认证策略)    | 区分浏览器受限通道、机器凭据豁免和最后管理员恢复                             |
| 规划多团队权限改造  | [现状、兼容迁移与五级权限设计](../docs/team-access-design.md) | 区分内部兼容层、只读预检、受限兼容schema与尚未开放的新角色，找到分期验收边界 |

## 覆盖范围

覆盖 Git HTTPS 推送入口、引用保护、Artifacts 交接和持久化推送事件；只追踪这些目录内与推送有关的文件。PR 审查、合并、Actions 执行器、OAuth/MFA、MCP、安装器、SPA 与其他数据库模块留给既有 docs 专题，本包不声称完整架构覆盖。认证策略与 UI 的实现说明见既有 docs 专题；提交、远端推送与生产部署分别核验。

本包采用 Lite 加代码地图：主流程先建立行为模型，地图用于定位，证据页用于审计。源码和脚本是实现事实的依据；旧文档或测试文件的存在不代表本轮实跑通过。

## 运行与验证入口

以下命令在仓库根运行；启动命令会占用开发端口，构建命令可能写业务产物，请先阅读根规则。

```sh
yarn install
yarn dev
# 以下为维护者验证命令，本轮未运行
yarn test:workers worker/src/__tests__/git/git-http.test.ts worker/src/__tests__/git/push-protection.test.ts worker/src/__tests__/git/push-events.test.ts
yarn typecheck
```

## 独立文档站与本地运行

`docs-site/` 是基于 VitePress 搭建的独立文档站点，与 CloudForge 核心业务应用完全解耦，为维护者与读者提供完整源码指南的可视化交互阅读体验。

### 架构与核心特性

- **依赖完全隔离**：文档站拥有独立的 `docs-site/package.json`，独立管理 VitePress 与 Vue 依赖。安装和构建不会污染仓库根部的锁文件与核心运行时依赖。
- **单点维护契约**：指南正文全部在 `repo-docs/` 统一维护。`docs-site/` 内的各个页面（如 `index.md`、`change-log.md`、`code-map.md`）通过 VitePress 的 include 机制（如 `&lt;!--@include: ../repo-docs/README.md--&gt;`）直接引入源文件，绝不冗余维护多份文档。
- **安全路径映射**：通过 `docs-site/.vitepress/guide-links.mts` 插件，将 Markdown 中引用文档目录之外的仓库文件链接安全转换为精确的代码文件路径，避免将私有业务代码或本机开发资产打包进静态构建产物。
- **全本地自托管字体**：内置 IBM Plex Sans（Latin 400/500/600/700）与 JetBrains Mono 字体文件于 `docs-site/.vitepress/theme/fonts/`，无任何外部 Google Fonts、公共 CDN 或第三方网络依赖，确保离线与私有化环境完全可用。
- **Primer 风格昼夜切换**：采用 Shadow DOM 封装的自定义元素 `<theme-toggle>`（`docs-site/.vitepress/theme/toggle.ts`），与 `DESIGN.md` 中定义的 GitHub Primer 功能色与表面层级无缝契合。
- **渐进式动效与无障碍降级**：基于本地 Anime.js（`docs-site/.vitepress/theme/motion.ts`）实现细腻的页面过渡动效。在禁用 JavaScript 的环境下，全站内容与排版保持完整可读；当系统开启 `prefers-reduced-motion` 偏好时自动关闭动效。

### 常用命令

文档站相关命令需在 `docs-site` 目录下执行（或通过根目录加 `--cwd` 参数）：

```sh
# 1. 安装文档站专属依赖（首次运行或依赖更新后）
yarn --cwd docs-site install --frozen-lockfile

# 2. 启动本地开发预览服务器（带热重载，默认 http://127.0.0.1:5173）
yarn --cwd docs-site docs:dev --host 127.0.0.1

# 3. 生产静态构建（产物输出至 docs-site/.vitepress/dist/）
yarn --cwd docs-site docs:build

# 4. 隔离目录构建（输出至仓库外部绝对路径，用于零污染验证）
yarn --cwd docs-site docs:build -- --outDir <仓库外绝对目录>

# 5. 本地预览已构建的生产静态站点
yarn --cwd docs-site docs:preview
```

文档构建只验证说明页面，不证明业务可用或已部署。

## 既有专题

- [既有总体架构](../docs/architecture.md)
- [开发与完整验证](../docs/development.md)
- [PR 审查与合并](../docs/auto-merge.md)
- [OIDC 身份绑定与 SSO](../docs/oidc.md)（先显式绑定，再发布登录能力；本地 MFA、来源撤权及近期密码边界）

独立网页构建会把文档目录之外的仓库链接显示为精确文件路径，避免产生失效跳转；原始 Markdown 仍保留可核对的源码链接。站点只发布指南，源码和本机资源不会随文档打包。

证据状态：除特别标注外，本页基于当前源码已确认。
