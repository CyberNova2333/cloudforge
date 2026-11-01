---
# Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
version: alpha
name: CloudForge Primer Design System
description: 面向 Cloudflare Workers 边缘运行时的 CloudForge 设计系统规范（基于 GitHub Primer 功能原语）。强制执行 14px 高密度排版、Light/Dark 双模式语义功能调色板、8px 空间网格、1px 边框 Box 容器以及 WCAG AA 无障碍标准。
colors:
  primary: '#0969da'
  accent-fg: '#0969da'
  accent-emphasis: '#0969da'
  accent-subtle: '#ddf4ff'
  accent-dark-fg: '#2f81f7'
  canvas-default: '#ffffff'
  canvas-overlay: '#ffffff'
  canvas-inset: '#f6f8fa'
  canvas-subtle: '#f6f8fa'
  canvas-dark-default: '#0d1117'
  canvas-dark-overlay: '#161b22'
  canvas-dark-inset: '#010409'
  canvas-dark-subtle: '#161b22'
  fg-default: '#1f2328'
  fg-muted: '#57606a'
  fg-on-emphasis: '#ffffff'
  fg-dark-default: '#f0f6fc'
  fg-dark-muted: '#8b949e'
  border-default: '#d0d7de'
  border-muted: '#d8dee4'
  border-subtle: '#e1e4e8'
  border-dark-default: '#30363d'
  border-dark-muted: '#21262d'
  success-fg: '#1a7f37'
  success-emphasis: '#1f883d'
  success-subtle: '#dafbe1'
  success-dark-fg: '#3fb950'
  danger-fg: '#cf222e'
  danger-emphasis: '#cf222e'
  danger-subtle: '#ffebe9'
  danger-dark-fg: '#f85149'
  attention-fg: '#9a6700'
  attention-subtle: '#fff8c5'
  attention-dark-fg: '#d29922'
  done-fg: '#8250df'
  done-dark-fg: '#a371f7'
typography:
  body-md:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  ui-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4285
    letterSpacing: 0px
  heading-page:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.2px
  heading-section:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0px
  code-block:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'IBM Plex Mono', monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6666
    letterSpacing: 0px
  code-inline:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'IBM Plex Mono', monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 3px
  md: 6px
  lg: 12px
  pill: 9999px
spacing:
  none: 0px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
components:
  repo-header:
    backgroundColor: '{colors.canvas-inset}'
    textColor: '{colors.fg-default}'
    typography: '{typography.heading-page}'
    rounded: '{rounded.none}'
    padding: '{spacing.md}'
  repo-header-dark:
    backgroundColor: '{colors.canvas-dark-inset}'
    textColor: '{colors.accent-dark-fg}'
    typography: '{typography.heading-page}'
    rounded: '{rounded.none}'
    padding: '{spacing.md}'
  file-browser-box:
    backgroundColor: '{colors.canvas-default}'
    textColor: '{colors.fg-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.none}'
  file-browser-header:
    backgroundColor: '{colors.canvas-subtle}'
    textColor: '{colors.fg-muted}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: '{spacing.sm}'
  file-browser-header-dark:
    backgroundColor: '{colors.canvas-dark-subtle}'
    textColor: '{colors.fg-dark-muted}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: '{spacing.sm}'
  commit-timeline-item:
    backgroundColor: '{colors.canvas-overlay}'
    textColor: '{colors.fg-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.sm}'
  commit-timeline-item-dark:
    backgroundColor: '{colors.canvas-dark-overlay}'
    textColor: '{colors.fg-dark-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.sm}'
  diff-addition-row:
    backgroundColor: '{colors.success-subtle}'
    textColor: '{colors.success-fg}'
    typography: '{typography.code-block}'
    rounded: '{rounded.none}'
    padding: '{spacing.xxs}'
  diff-addition-row-dark:
    backgroundColor: '{colors.canvas-dark-default}'
    textColor: '{colors.success-dark-fg}'
    typography: '{typography.code-block}'
    rounded: '{rounded.none}'
    padding: '{spacing.xxs}'
  diff-deletion-row:
    backgroundColor: '{colors.danger-subtle}'
    textColor: '{colors.danger-fg}'
    typography: '{typography.code-block}'
    rounded: '{rounded.none}'
    padding: '{spacing.xxs}'
  diff-deletion-row-dark:
    backgroundColor: '{colors.canvas-dark-default}'
    textColor: '{colors.danger-dark-fg}'
    typography: '{typography.code-block}'
    rounded: '{rounded.none}'
    padding: '{spacing.xxs}'
  diff-hunk-header:
    backgroundColor: '{colors.accent-subtle}'
    textColor: '{colors.accent-fg}'
    typography: '{typography.code-block}'
    rounded: '{rounded.none}'
    padding: '{spacing.xs}'
  button-default:
    backgroundColor: '{colors.canvas-subtle}'
    textColor: '{colors.fg-default}'
    typography: '{typography.ui-label}'
    rounded: '{rounded.md}'
    padding: '{spacing.xs}'
    height: 32px
  button-primary:
    backgroundColor: '{colors.accent-emphasis}'
    textColor: '{colors.fg-on-emphasis}'
    typography: '{typography.ui-label}'
    rounded: '{rounded.md}'
    padding: '{spacing.xs}'
    height: 32px
  button-danger:
    backgroundColor: '{colors.danger-emphasis}'
    textColor: '{colors.fg-on-emphasis}'
    typography: '{typography.ui-label}'
    rounded: '{rounded.md}'
    padding: '{spacing.xs}'
    height: 32px
  badge-open:
    backgroundColor: '{colors.success-emphasis}'
    textColor: '{colors.fg-on-emphasis}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.pill}'
    padding: '{spacing.xxs}'
  badge-attention:
    backgroundColor: '{colors.attention-subtle}'
    textColor: '{colors.attention-fg}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.pill}'
    padding: '{spacing.xxs}'
  badge-attention-dark:
    backgroundColor: '{colors.canvas-dark-default}'
    textColor: '{colors.attention-dark-fg}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.pill}'
    padding: '{spacing.xxs}'
  badge-merged:
    backgroundColor: '{colors.done-fg}'
    textColor: '{colors.fg-on-emphasis}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.pill}'
    padding: '{spacing.xxs}'
  badge-merged-dark:
    backgroundColor: '{colors.canvas-dark-default}'
    textColor: '{colors.done-dark-fg}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.pill}'
    padding: '{spacing.xxs}'
  empty-state-box:
    backgroundColor: '{colors.canvas-default}'
    textColor: '{colors.fg-muted}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.xl}'
  dark-shell-surface:
    backgroundColor: '{colors.canvas-dark-default}'
    textColor: '{colors.fg-dark-default}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
  border-swatch-default:
    backgroundColor: '{colors.border-default}'
    textColor: '{colors.fg-default}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '{spacing.xxs}'
  border-swatch-muted:
    backgroundColor: '{colors.border-muted}'
    textColor: '{colors.fg-default}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '{spacing.xxs}'
  border-swatch-subtle:
    backgroundColor: '{colors.border-subtle}'
    textColor: '{colors.fg-default}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '{spacing.xxs}'
  border-swatch-dark-default:
    backgroundColor: '{colors.border-dark-default}'
    textColor: '{colors.fg-dark-default}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '{spacing.xxs}'
  border-swatch-dark-muted:
    backgroundColor: '{colors.border-dark-muted}'
    textColor: '{colors.fg-dark-default}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '{spacing.xxs}'
---

<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# CloudForge Primer 设计系统规范 (`DESIGN.md`)

本文档是 **CloudForge** 机器可读、人类可评审的设计系统“宪法”。它以 GitHub Primer 为信息架构与交互密度的参考基准，提取颜色、字阶、空间与核心 Git 组件契约，指导运行在 Cloudflare Workers 边缘环境下的全部前端界面改造。

上方 YAML frontmatter 定义的全部原语均支持通过 `@google/design.md export DESIGN.md --format dtcg` 导出为 W3C Design Tokens (`$value` / `$type`) 标准格式，并与项目样式级联入口（`src/styles/tokens.css` 及 `src/styles/primer-bridge.css`）一一绑定。

---

## Overview

CloudForge 引用 GitHub Primer 的四条核心设计哲学作为不可协商的顶层原则：

1. **Productive Complexity（高产出的复杂性）**：专为高密度工程信息（代码树、提交时间线、Unified/Split Diff、评审线程）设计，但绝不让用户感到视觉压迫。高密度通过克制的 `14px` 正文锚点、紧凑的 `32px` 控件高度与清晰的 `1px solid` 结构边框实现，而非依赖夸张留白或装饰性外壳。
2. **Accessibility-First（无障碍优先）**：前景/背景对比度与键盘焦点状态严格满足 WCAG 2.1 AA 标准（正文文本最低 `4.5:1`，UI 控件与大号文本最低 `3:1`）。所有可交互元素在 Light 与 Dark 模式下均必须呈现清晰可见的 `2px` 蓝色焦点环（focus ring）。
3. **Pragmatic Visuals（务实视觉）**：坚持操作系统原生 UI 字体栈、零装饰性插画、零渐变背景与性能优先的 CSS 原语，契合 Cloudflare Workers 边缘静态资源约束。等宽代码字体作为一等公民对待。
4. **Consistency through Primitives（原语驱动的一致性）**：所有视觉决策——颜色、画布层级、边框灰阶、间距、圆角与字阶——均必须源自功能原语（`canvas.*`、`fg.*`、`border.*`、`accent.*`、`success.*`、`danger.*`、`attention.*`），严禁在组件或页面样式中临时发明 hex 色值或局部魔数。

---

## Colors

CloudForge 使用 Primer 的**功能调色板（Functional Palette）**，按语义角色命名而非按色相命名（如使用 `accent.fg`、`canvas.subtle`、`border.default`，而非 `blue-500` 或 `gray-100`），使 Light 与 Dark 模式共享同一套组件样式表，仅切换底层 token 映射。

### W3C `$value/$type` Token 注册表与来源依据

以下每个 token 均源自 `@primer/primitives`（`dist/css/functional/themes/light.css` 与 `dist/css/functional/themes/dark.css`），并遵循 W3C Design Tokens (`$type: "color"`) 规范：

| Primer 功能 Token  | YAML 键名                                | W3C `$type` | Light `$value` | Dark `$value`           | CSS 变量桥接 (`primer-bridge.css`)         | 来源依据与用途                                                                             |
| :----------------- | :--------------------------------------- | :---------- | :------------- | :---------------------- | :----------------------------------------- | :----------------------------------------------------------------------------------------- |
| `accent.fg`        | `accent-fg` / `accent-dark-fg`           | `color`     | `#0969da`      | `#2f81f7`               | `--fgColor-accent` / `--accent`            | Primer Functional Light/Dark `--fgColor-accent`：主交互链接、活动分支引用、2px 焦点环      |
| `accent.emphasis`  | `accent-emphasis`                        | `color`     | `#0969da`      | `#1f6feb`               | `--bgColor-accent-emphasis`                | Primer `--bgColor-accent-emphasis`：Primary 主按钮填充、选中态高亮、行内评论触发器背景     |
| `accent.subtle`    | `accent-subtle`                          | `color`     | `#ddf4ff`      | `rgba(56,139,253,0.15)` | `--bgColor-accent-muted` / `--accent-sub`  | Primer `--bgColor-accent-muted`：Diff hunk header (`@@ ... @@`) 背景、选中文件行底色       |
| `canvas.default`   | `canvas-default` / `canvas-dark-default` | `color`     | `#ffffff`      | `#0d1117`               | `--bgColor-default` / `--bg`               | Primer `--bgColor-default`：页面主画布、Box 容器内部默认底色、代码块底色                   |
| `canvas.overlay`   | `canvas-overlay` / `canvas-dark-overlay` | `color`     | `#ffffff`      | `#161b22`               | `--bgColor-overlay` / `--surface`          | Primer `--bgColor-overlay`：下拉菜单、Popover、模态弹窗、时间线浮层卡片底色                |
| `canvas.inset`     | `canvas-inset` / `canvas-dark-inset`     | `color`     | `#f6f8fa`      | `#010409`               | `--bgColor-inset` / `--bg-2`               | Primer `--bgColor-inset`：全局顶栏、仓库头部横幅（Repository Header）、内凹槽位底色        |
| `canvas.subtle`    | `canvas-subtle` / `canvas-dark-subtle`   | `color`     | `#f6f8fa`      | `#161b22`               | `--bgColor-muted` / `--surface-2`          | Primer `--bgColor-muted`：Box 头部栏、表头、列表/文件行悬停（hover）背景、Default 按钮底色 |
| `fg.default`       | `fg-default` / `fg-dark-default`         | `color`     | `#1f2328`      | `#f0f6fc`               | `--fgColor-default` / `--ink`              | Primer `--fgColor-default`：一等正文、文件名、提交标题、代码默认前景色                     |
| `fg.muted`         | `fg-muted` / `fg-dark-muted`             | `color`     | `#57606a`      | `#8b949e`               | `--fgColor-muted` / `--ink-2`              | Primer `--fgColor-muted`：次要元数据、提交摘要、相对时间、Diff 行号、面包屑分隔符          |
| `fg.onEmphasis`    | `fg-on-emphasis`                         | `color`     | `#ffffff`      | `#ffffff`               | `--fgColor-onEmphasis`                     | Primer `--fgColor-onEmphasis`：Primary / Danger / Open 实心强调背景上的高对比白色文字      |
| `border.default`   | `border-default` / `border-dark-default` | `color`     | `#d0d7de`      | `#30363d`               | `--borderColor-default` / `--line-2`       | Primer `--borderColor-default`：默认结构边框（Box 外框、输入框边框、按钮边框）             |
| `border.muted`     | `border-muted` / `border-dark-muted`     | `color`     | `#d8dee4`      | `#21262d`               | `--borderColor-muted` / `--line`           | Primer `--borderColor-muted`：次级分隔边框（文件列表行分隔线、提交列表项分隔线）           |
| `border.subtle`    | `border-subtle`                          | `color`     | `#e1e4e8`      | `rgba(240,246,252,0.1)` | `--borderColor-translucent`                | Primer Classic 灰阶边框步进 `#e1e4e8`：细微结构线、代码与 Diff 行号栏纵向内分隔线          |
| `success.fg`       | `success-fg` / `success-dark-fg`         | `color`     | `#1a7f37`      | `#3fb950`               | `--fgColor-success` / `--ok`               | Primer `--fgColor-success`：Open 状态图标、通过的 Check、Diff 新增行数统计（`+N`）         |
| `success.emphasis` | `success-emphasis`                       | `color`     | `#1f883d`      | `#238636`               | `--bgColor-success-emphasis`               | Primer `--bgColor-success-emphasis`：Open 状态徽章实心填充背景                             |
| `success.subtle`   | `success-subtle`                         | `color`     | `#dafbe1`      | `rgba(46,160,67,0.15)`  | `--bgColor-success-muted` / `--ok-sub`     | Primer `--bgColor-success-muted`：Diff 新增代码行（`+`）背景填充色                         |
| `danger.fg`        | `danger-fg` / `danger-dark-fg`           | `color`     | `#cf222e`      | `#f85149`               | `--fgColor-danger` / `--bad`               | Primer `--fgColor-danger`：Danger 按钮文字、失败 Check、Diff 删除行数统计（`-N`）          |
| `danger.emphasis`  | `danger-emphasis`                        | `color`     | `#cf222e`      | `#da3633`               | `--bgColor-danger-emphasis`                | Primer `--bgColor-danger-emphasis`：破坏性操作确认按钮悬停/激活实心背景                    |
| `danger.subtle`    | `danger-subtle`                          | `color`     | `#ffebe9`      | `rgba(248,81,73,0.15)`  | `--bgColor-danger-muted` / `--bad-sub`     | Primer `--bgColor-danger-muted`：Diff 删除代码行（`-`）背景填充色                          |
| `attention.fg`     | `attention-fg` / `attention-dark-fg`     | `color`     | `#9a6700`      | `#d29922`               | `--fgColor-attention` / `--warn`           | Primer `--fgColor-attention`：保护分支提示、待审状态、进行中 Check 指示色                  |
| `attention.subtle` | `attention-subtle`                       | `color`     | `#fff8c5`      | `rgba(187,128,9,0.15)`  | `--bgColor-attention-muted` / `--warn-sub` | Primer `--bgColor-attention-muted`：注意横幅底色、代码查看器锚点目标行高亮底色             |
| `done.fg`          | `done-fg` / `done-dark-fg`               | `color`     | `#8250df`      | `#a371f7`               | `--fgColor-done` / `--purple`              | Primer `--fgColor-done`：已合并（Merged）Pull Request 状态与完成图标色                     |

### 画布分层与边框灰阶规则

- **用画布分层替代重阴影**：界面深度由四级画布系统（`canvas.inset` $\rightarrow$ `canvas.default` $\rightarrow$ `canvas.subtle` $\rightarrow$ `canvas.overlay`）配合 `1px solid` 边框灰阶（Light 模式下至少包含 `#d0d7de` 默认外框、`#d8dee4` 行间分隔、`#e1e4e8` 行号细线；Dark 模式下对应 `#30363d` 与 `#21262d`）共同表达。
- **严禁渐变与高饱和装饰色**：禁止在任何按钮、顶栏、徽章或卡片背景中使用 `linear-gradient` / `radial-gradient`；悬停状态仅允许使用背景色微移（切换至 `canvas.subtle`）或边框色阶变化。

---

## Typography

CloudForge 的排版系统致力于在密集信息（深层文件路径、7 位短 SHA、120 列源码）与长时间阅读舒适度之间取得精确平衡。

### 字体栈（W3C `$value/$type` 定义）

```json
{
  "font": {
    "sans": {
      "$type": "fontFamily",
      "$value": [
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "Noto Sans",
        "Helvetica",
        "Arial",
        "sans-serif",
        "Apple Color Emoji",
        "Segoe UI Emoji"
      ],
      "$description": "Primer --fontStack-sansSerif 系统 UI 字体优先栈，零首屏字体网络阻塞，保证原生渲染清晰度。"
    },
    "mono": {
      "$type": "fontFamily",
      "$value": [
        "ui-monospace",
        "SFMono-Regular",
        "SF Mono",
        "Menlo",
        "Consolas",
        "Liberation Mono",
        "IBM Plex Mono",
        "monospace"
      ],
      "$description": "Primer --fontStack-monospace 一等公民等宽字体栈，用于源码查看、Diff 行、SHA 短码、分支/标签引用与路径。"
    }
  }
}
```

### 字阶体系与来源依据

| Primer 字阶 Token        | YAML 键名         | W3C `$type`  | 字号 (`$value`)         | 字重  | 行高              | 来源依据与使用规范                                                                                                                                                                     |
| :----------------------- | :---------------- | :----------- | :---------------------- | :---- | :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text.body.size.medium`  | `body-md`         | `typography` | **`14px`** (`0.875rem`) | `400` | `1.5` (`20px`)    | **全局 `body` 强制基准字号**（源自 Primer `--text-body-size-medium`）。这是 GitHub 平衡信息密度与可读性的核心锚点，**严禁改为 `15px` 或 `16px`**。用于文件表格、提交说明、正文与导航。 |
| `text.body.size.small`   | `body-sm`         | `typography` | `12px` (`0.75rem`)      | `400` | `1.5` (`18px`)    | 源自 Primer `--text-body-size-small`：用于相对时间戳、计数徽章、可见性标签、表头辅助说明。                                                                                             |
| `control.medium`         | `ui-label`        | `typography` | `14px` (`0.875rem`)     | `600` | `1.4285` (`20px`) | 源自 Primer 按钮与导航标签规范：用于按钮文字、激活态子导航标签、面包屑当前节点、提交标题强调。                                                                                         |
| `text.title.size.medium` | `heading-page`    | `typography` | `20px` (`1.25rem`)      | `600` | `1.4` (`28px`)    | 源自 Primer `--text-title-size-medium`：用于仓库头部标题（`owner / repo`）、页面主标题、PR/Issue 标题。                                                                                |
| `text.title.size.small`  | `heading-section` | `typography` | `16px` (`1rem`)         | `600` | `1.5` (`24px`)    | 源自 Primer `--text-title-size-small`：用于 Box 区块标题（如 `README.md` 头部、提交日期分组标题、空状态主标题）。                                                                      |
| `text.codeBlock`         | `code-block`      | `typography` | `12px` (`0.75rem`)      | `400` | `1.6666` (`20px`) | 源自 Primer `--text-codeBlock-size`：用于源码全文行、Diff 代码行、行号栏（gutter）与 hunk header。                                                                                     |
| `text.codeInline`        | `code-inline`     | `typography` | `12px` (`0.75rem`)      | `500` | `1.5` (`18px`)    | 源自 Primer `--text-codeInline-size`：用于 7 位提交 SHA 短码、分支/标签引用胶囊、行内 `<code>`。                                                                                       |

- **通过字重与间距区分层级**：标题与正文的层级仅通过 `font-weight`（`600` vs `400`）和垂直间距（`8px`–`16px`）区分，严禁使用彩色标题文字、全大写字距拉伸或大号渐变字（禁止仓库工作流中出现 `24px`–`32px` 的浮夸大标题）。

---

## Layout & Spacing

### 8px 基准间距系统

所有内边距（padding）、外边距（margin）、Flex/Grid 间隙（gap）均基于 **8px 基准间距系统**（含 `4px` 半步进，W3C `$type: "dimension"`）：

| Primer 间距 Token | YAML 键名 | `$value` | 来源依据与典型应用                                                                             |
| :---------------- | :-------- | :------- | :--------------------------------------------------------------------------------------------- |
| `base-size-0`     | `none`    | `0px`    | 表格容器或无缝拼接 Box 的内边距归零                                                            |
| `base-size-4`     | `xxs`     | `4px`    | Primer `--base-size-4`：图标与文字微间距、徽章内边距、Diff 行紧凑内边距                        |
| `base-size-8`     | `xs`      | `8px`    | Primer `--base-size-8`：按钮组间距、工具栏控件间距、紧凑单元格内边距                           |
| `base-size-12`    | `sm`      | `12px`   | Primer `--base-size-12`：Box 头部与列表行垂直内边距（`8px 16px` 或 `12px 16px`）、输入框内边距 |
| `base-size-16`    | `md`      | `16px`   | Primer `--base-size-16`：标准 Box 容器内边距、卡片间距、工具栏与主表格间距                     |
| `base-size-24`    | `lg`      | `24px`   | Primer `--base-size-24`：主内容区与右侧栏（About 栏）列间距、页面水平安全边距                  |
| `base-size-32`    | `xl`      | `32px`   | Primer `--base-size-32`：空状态容器垂直内边距、页面主容器上下呼吸空间                          |

### 基本布局单元：Primer `Box` 与导航分隔

- **`Box` 边框与圆角契约**：所有成组信息块（文件浏览器表格、README 面板、每日提交分组、单个文件的 Diff 容器、侧边栏模块）均以 Primer `Box` 作为基本布局单元——强制使用 **`1px solid` 边框**（`border.default`：`#d0d7de` Light / `#30363d` Dark）+ **`6px` 圆角**（`rounded.md`）。
- **Box 内部行分隔**：`Box-header` 使用 `canvas.subtle` 背景与底部 `1px solid border.default`；内部相邻行（`Box-row`）使用 `1px solid border.muted`（`#d8dee4` Light / `#21262d` Dark）分隔。
- **导航不用粗分隔线**：全局顶栏（`AppShell`）与仓库头部/子导航（`RepoLayout`）通过画布背景层级（`canvas.inset` `#f6f8fa` Light / `#010409` Dark）与间距完成区域分割，底部仅保留 `1px solid border.default` 细线；仅当前激活的导航 Tab 下方显示 `2px` 指示条。

### 视口基准与响应式退化

- **1920px 基准视口**：桌面宽屏下主容器居中（仓库主工作区 `max-width: 1280px`，两侧 `24px`–`32px` 水平内边距），保证文件表格与阅读流不会在 1920px 视口下过度拉宽导致扫视困难，同时让代码与 Diff 视图拥有充足横向空间。
- **1280px 标准桌面视口**：主栏（`minmax(0, 1fr)`）+ 右侧仓库信息栏（`296px`，间距 `24px`）双栏布局无横向滚动条；长文件名与长提交说明严格单行截断（`text-overflow: ellipsis`）。
- **移动端与窄视口退化（`< 768px`）**：双栏自动折叠为单栏纵向堆叠；文件列表隐藏次要的“最后提交信息”列，仅保留文件名与相对时间；仓库子导航支持横向平滑滚动而不撑破页面宽度。

---

## Components

以下 6 类核心组件必须完整实现 5 种交互状态（`default`、`hover`、`focus`、`active`、`disabled`），满足 WCAG 2.1 AA 无障碍要求，并严格执行 Do / Don't 规则。

### 1. Repository Header（仓库头部：`RepoLayout`）

承载仓库路径上下文（`owner / repo`）、可见性徽章（`Public` / `Internal` / `Private`）、`Watch / Fork / Star` 计数按钮组，以及仓库二级导航栏（`Code`、`Issues`、`Pull requests`、`Actions`、`Settings`）。

- **交互状态**：
  - `default`：背景为 `canvas.inset`（Light `#f6f8fa` / Dark `#010409`），底部为 `1px solid border.default`。`owner / repo` 字号 `20px`（`owner` 字重 `400`、`repo` 字重 `600`，颜色 `accent.fg`）；可见性徽章为 `12px` `fg.muted` 胶囊（`border-radius: 9999px`，`1px solid border.default`）。右侧 `Watch`、`Fork`、`Star` 采用 `32px` 高度分段按钮（左侧操作按钮 + 右侧计数胶囊，背景 `canvas.subtle`，边框 `border.default`）。
  - `hover`：`owner` 与 `repo` 链接显示下划线；`Watch / Fork / Star` 按钮背景微移至 `#eef1f4`（Light）/ `#21262d`（Dark）；二级导航未激活项悬停背景变为 `canvas.subtle`（`6px` 圆角）。
  - `focus`：键盘 `:focus-visible` 时呈现 `2px solid accent.fg`（`#0969da` / `#2f81f7`）焦点环，在 `canvas.inset` 背景上对比度清晰。
  - `active`：按钮按下背景微深（`#e6eaef` Light / `#282e36` Dark）；当前激活的子导航 Tab 文字为 `fg.default`（字重 `600`），底部带 `2px` 实心激活指示线。
  - `disabled`：无权限或不可用操作按钮设置 `opacity: 0.5`、`cursor: not-allowed`，悬停不改变背景与边框。
- **可访问性要求**：
  - 仓库头部面包屑使用 `<nav aria-label="Repository">` 包裹，子导航使用 `<nav aria-label="Repository navigation">`，当前激活 Tab 标记 `aria-current="page"`。
  - `Watch / Fork / Star` 按钮提供包含当前计数的 `aria-label`（如 `Star 仓库，当前 12 个星标`）。
- **Do / Don't**：
  - ✅ **Do**：将仓库名称、可见性徽章与右侧 `Watch / Fork / Star` 分组计数保持在同一水平顶行（`16px` 垂直内边距），二级导航紧随其下并贴合底部分隔线。
  - ❌ **Don't**：不要把仓库名放大到 `32px` 展示型字号，不要移除 `canvas.inset` 头部背景层，不要虚构 CloudForge 后端未实现的假导航项（如 `Projects`、`Discussions`、`Wiki`）。

### 2. File Browser（文件浏览器：`RepoCode`、`CodeToolbar`、`FileTable`、`BlobView`）

包含分支/标签切换器、路径面包屑、Clone 按钮工具栏（`CodeToolbar`）、VS Code / Primer 风格左侧文件树 + 右侧文件列表表格（`FileTable`），以及支持语法高亮（`highlight.js` prettylights 映射）与行号栏的文件内容查看器（`BlobView`）。

- **交互状态**：
  - `default`：外层为 `1px solid border.default` + `6px` 圆角的 `Box`。顶部 `Box-header` 使用 `canvas.subtle` 背景，展示最近一次提交的作者头像（`20px`）、提交标题、7 位等宽短 SHA 与相对时间。文件行高 `38px`–`40px`（内边距 `8px 16px`），左侧为文件类型/目录 Octicon 图标（目录用 `accent.fg` / `#54aeff`，普通文件用 `fg.muted`），中间为单行截断的最后提交信息（`fg.muted`），右侧为不换行的相对时间（`fg.muted`）。
  - `hover`：文件行或左侧文件树节点悬停时，背景在 `120ms ease-out` 内平滑切换为 `canvas.subtle`（`#f6f8fa` Light / `#161b22` Dark），文件名变为 `accent.fg` 并带下划线。**保留原有的悬停数据预取（hover prefetch）逻辑，但视觉反馈必须克制**（零位移、零缩放、零发光阴影）。
  - `focus`：分支切换按钮、面包屑各级链接、文件树节点、表格文件名链接及 Raw/Copy 按钮在 `:focus-visible` 下均显示 `2px solid accent.fg` 焦点环，且不被容器 `overflow: hidden` 裁切。
  - `active`：点击行或左侧树当前选中文件节点使用 `accent.subtle` 或 `canvas.inset` 背景与 `font-weight: 600` 标识。
  - `disabled`：空文件或二进制文件下不可用的复制/编辑操作置为 `opacity: 0.5`、`cursor: not-allowed`。
- **可访问性要求**：
  - 文件列表采用语义化 `<table>`（含 `<thead>` 列名：`Name`、`Last commit message`、`Last commit date`）；左侧文件树具备 `role="tree"` / `role="treeitem"` 与 `aria-expanded` 属性。
  - `BlobView` 行号栏设置 `user-select: none`，确保用户框选复制代码时不会混入行号。
- **Do / Don't**：
  - ✅ **Do**：对文件名列与最后提交信息列强制设置 `max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`，确保在 `1280px` 与 `1920px` 视口下绝不产生横向溢出。
  - ❌ **Don't**：不要把文件表格做成无边框悬浮面板，不要使用斑马纹交替底色，行与行之间仅用 `1px solid border.muted`（`#d8dee4` / `#21262d`）分隔。

### 3. Commit Timeline（提交时间线：`RepoCommits`、`CommitList`）

使用 Primer 的 Timeline 模式展示按日期分组的提交活动流：左侧纵向时间轴线 + 日期节点图标 + 右侧包裹在 `Box` 内的当日提交列表。

- **交互状态**：
  - `default`：每个日期分组顶部显示 `GitCommitIcon` 节点与 `Commits on YYYY-MM-DD`（`14px` `fg.muted`），左侧贯穿 `2px` 宽的 `border.muted` 纵向时间线轨。当日所有提交包裹在一个 `1px solid border.default`（`6px` 圆角）的 `Box` 中，每行左侧为提交标题（`14px`，字重 `600`，`fg.default`）、作者头像（`20px` 圆形）+ 作者名 + 相对时间（`12px` `fg.muted`）；右侧为对齐的动作簇（复制完整 SHA 按钮 + `12px` 等宽 7 位 SHA 短码按钮 + 浏览该提交时代码树 `<>` 按钮）。
  - `hover`：提交行悬停背景切换为 `canvas.subtle`；提交标题悬停变为 `accent.fg`；右侧 SHA 按钮悬停边框加深为 `border.default`。
  - `focus`：提交标题、展开详情 `...` 按钮、复制 SHA 按钮与 7 位短码链接在 `:focus-visible` 下呈现 `2px solid accent.fg` 焦点环。
  - `active`：点击复制 SHA 后图标切换为 `success.fg`（`#1a7f37` / `#3fb950`）勾选态。
  - `disabled`：分页器（`Newer` / `Older`）到达边界时置为 `disabled`（文字 `fg.muted`，`opacity: 0.5`）。
- **可访问性要求**：
  - 日期分组标题使用语义化标题标签（`<h3>`），相对时间使用 `<time dateTime={...}>`，复制 SHA 按钮提供明确的 `aria-label="Copy full SHA for <short-sha>"`。
- **Do / Don't**：
  - ✅ **Do**：保留 Primer Timeline 左侧纵向轴线与日期节点，并将右侧 7 位等宽 SHA 短码与复制按钮在垂直方向严格对齐，方便快速扫视比对。
  - ❌ **Don't**：不要在提交列表中直接展示 40 位完整 SHA，不要将每条提交拆成带阴影的独立卡片。

### 4. Diff Viewer（差异查看器：`CommitView`、`DiffView`）

渲染单次提交或 Pull Request 的文件变更摘要与逐文件 Unified / Split Diff，包含双栏行号（旧行号 / 新行号）、新增/删除语义背景色、hunk header（`@@ -a,b +c,d @@`）以及行内评论入口（`+` 按钮）。

- **交互状态**：
  - `default`：每个变更文件独立封装在一个 `1px solid border.default` + `6px` 圆角的 `Box` 中（间距 `16px`）。
    - **文件头部栏（`diff-file-header`）**：`canvas.subtle` 背景，含折叠箭头、变更行数统计（`+N` 使用 `success.fg`，`-N` 使用 `danger.fg`）、`12px` 等宽加粗文件路径与状态标签。
    - **Hunk Header（`@@ ... @@`）**：背景 `accent.subtle`（Light `#ddf4ff` / Dark `rgba(56,139,253,0.15)`），文字 `accent.fg`（`#0969da` / `#2f81f7`），`12px` 等宽字体。
    - **新增行（`+`）**：代码区背景 `success.subtle`（Light `#dafbe1` / Dark `rgba(46,160,67,0.15)`），行号栏背景 `#aceebb`（Light）/ `rgba(46,160,67,0.3)`（Dark），代码文字保持 `fg.default`（`#1f2328` / `#f0f6fc`）。
    - **删除行（`-`）**：代码区背景 `danger.subtle`（Light `#ffebe9` / Dark `rgba(248,81,73,0.15)`），行号栏背景 `#ffcecb`（Light）/ `rgba(248,81,73,0.3)`（Dark），代码文字保持 `fg.default`（`#1f2328` / `#f0f6fc`）。
    - **上下文行**：背景 `canvas.default`，双列行号栏（每列宽 `48px`，右对齐 `12px` 等宽 `fg.muted` 数字，右侧 `1px solid border.subtle` 分隔）。
  - `hover`：鼠标悬停代码行时，在行号栏与代码区交界处显现 `20px × 20px` 的行内评论入口按钮（`+` 图标，`accent.emphasis` `#0969da` 蓝底白字，`border-radius: 6px`）；文件头部折叠按钮悬停背景变为 `border.muted`。
  - `focus`：折叠按钮、行内评论 `+` 按钮、文件路径链接在键盘聚焦时显示 `2px solid accent.fg` 焦点环。
  - `active`：点击文件头部折叠按钮收起 Diff 表格主体，仅保留 `Box-header`。
  - `disabled`：二进制文件或超大省略 Diff 显示静态提示行（`canvas.subtle` 背景，`fg.muted` 文字），不触发行内评论按钮。
- **可访问性要求**：
  - 新增/删除行除了背景色区分外，必须在代码列首保留 `+` / `-` 文本或伪元素符号标识，不单纯依赖红绿色觉。
  - 新增行（`#1f2328` on `#dafbe1` 对比度 `13.4:1`）与删除行（`#1f2328` on `#ffebe9` 对比度 `13.7:1`）严格满足 WCAG AAA 对比度。
- **Do / Don't**：
  - ✅ **Do**：新增与删除背景色严格绑定 `success.subtle`（`--bgColor-success-muted`）与 `danger.subtle`（`--bgColor-danger-muted`），代码前景文字统一使用高对比度的 `fg.default`。
  - ❌ **Don't**：不要把整行新增或删除代码的字体直接染成高饱和纯绿/纯红，不要让行号栏随横向滚动条滚出视野或与代码行错位。

### 5. Buttons（按钮：`Default` / `Primary` / `Danger`）

提供三种标准变体，默认高度 `32px`（小号 `.btn-sm` 为 `28px`），圆角 `6px`，边框 `1px solid`，字号 `14px`（字重 `500`–`600`）。

- **三种变体与状态**：
  1. **Default（默认次要按钮 `.btn`）**：
     - `default`：背景 `canvas.subtle`（Light `#f6f8fa` / Dark `#21262d`），文字 `fg.default`（`#1f2328` / `#f0f6fc`），边框 `1px solid border.default`（`#d0d7de` / `#30363d`），仅允许极轻底边阴影 `0 1px 0 rgba(27,31,35,0.04)`。
     - `hover`：背景微移至 `#eef1f4`（Light）/ `#30363d`（Dark），边框变为 `#c5cdd5`（Light）/ `#8b949e`（Dark）。
     - `focus`：`2px solid accent.fg`（`#0969da` / `#2f81f7`）焦点环。
     - `active`：背景变为 `#e6eaef`（Light）/ `#282e36`（Dark），阴影移除。
     - `disabled`：`opacity: 0.5`，`cursor: not-allowed`。
  2. **Primary（主操作按钮 `.btn-primary` —— GitHub Blue）**：
     - `default`：背景使用 GitHub Blue `accent.emphasis`（Light `#0969da` / Dark `#1f6feb`），文字 `fg.onEmphasis`（`#ffffff`），边框 `1px solid rgba(27,31,35,0.15)`。
     - `hover`：背景变为 `#0860ca`（Light）/ `#388bfd`（Dark）。
     - `focus`：`2px solid accent.fg` 焦点环，带 `2px` 双层间隙（`box-shadow: 0 0 0 2px var(--bgColor-default), 0 0 0 4px var(--fgColor-accent)`），确保蓝底按钮上的蓝色焦点环依然清晰可见。
     - `active`：背景变为 `#0757ba`（Light）/ `#1f6feb`（Dark）。
     - `disabled`：`opacity: 0.5`，`cursor: not-allowed`。
  3. **Danger（危险操作按钮 `.btn-danger` —— 仅用于破坏性操作）**：
     - `default`：背景 `canvas.subtle`（`#f6f8fa` / `#21262d`），文字 `danger.fg`（`#cf222e` / `#f85149`），边框 `1px solid border.default`（或在最终确认弹窗中使用实心 `danger.emphasis` `#cf222e` 底 + `#ffffff` 字）。
     - `hover`：背景切换为实心 `danger.emphasis`（`#cf222e` Light / `#da3633` Dark），文字切换为 `#ffffff`，边框 `danger.emphasis`。
     - `focus`：`2px solid accent.fg`（`#0969da` / `#2f81f7`）焦点环，带 `2px` 间隙。
     - `active`：背景变为 `#a40e26`（Light）/ `#b62324`（Dark），文字 `#ffffff`。
     - `disabled`：`opacity: 0.5`，`cursor: not-allowed`。
- **可访问性要求**：
  - 仅含图标的按钮必须提供 `aria-label` 与 `title`；所有按钮支持 `Enter` 与 `Space` 键盘触发。
- **Do / Don't**：
  - ✅ **Do**：同一局部视图仅突出一个 `Primary` 按钮（如 `New pull request`、`Clone`、`Create repository`）；`Danger` 变体严格限定在删除仓库、删除分支、吊销令牌等不可逆破坏性操作中使用。
  - ❌ **Don't**：严禁在按钮上使用渐变背景，严禁将取消/关闭按钮设为 `Danger` 变体。

### 6. Empty States（空状态：`EmptyState`、`QuickSetup`）

用于空仓库初始化引导（`QuickSetup`）、无提交历史、无匹配搜索结果或空列表状态。

- **交互状态**：
  - `default`：包裹在 `1px solid border.default` + `6px` 圆角的 `Box` 容器内，内容水平垂直居中（上下内边距 `32px`–`48px`，左右 `24px`，背景 `canvas.default`）。仅包含一个克制的 `24px`–`32px` 单色 `fg.muted` Octicon 图标（可选）、一句 `16px` 加粗主标题（`fg.default`）、一句不超过 `480px` 宽度的 `14px` 说明文字（`fg.muted`），以及一个主操作按钮（或空仓库的 Git 命令行快速推送指引框 `canvas.subtle`）。
  - `hover` / `focus` / `active` / `disabled`：内部主操作按钮或命令复制按钮直接继承上述 `Buttons` 的五态规范。
- **可访问性要求**：
  - 空状态容器设置语义化标题与 `role="status"`（当由筛选动态触发时），装饰性图标设置 `aria-hidden="true"`。
- **Do / Don't**：
  - ✅ **Do**：居中对齐、无插画堆砌，坚持“一句清晰说明 + 一个主操作（或空仓库 Git 推送命令块）”的极简结构。
  - ❌ **Don't**：不要堆砌多色 SVG 插图、营销横幅或无关的装饰性动画。

---

## Focus & Motion

### 键盘焦点（Focus）规范

- **全局 2px 蓝色焦点环**：所有可聚焦交互元素（`a`、`button`、`input`、`select`、`textarea`、`summary`、`[tabindex="0"]`）在 `:focus-visible` 状态下，必须呈现 **`2px solid`** 的蓝色焦点环（Light 模式 `#0969da`，Dark 模式 `#2f81f7`，即 `var(--fgColor-accent)`）。
- **任何背景上清晰可见**：在浅色/深色默认画布上使用 `outline: 2px solid var(--fgColor-accent); outline-offset: -2px`（或 `2px`）；在实心蓝色/红色按钮（`.btn-primary`、`.btn-danger`）上通过 `2px` 画布色内环隔离，保证焦点环在任何背景上均具备 `3:1` 以上的边界对比度。
- **禁止无替代移除焦点**：严禁単独编写 `outline: none` 而不提供 `:focus-visible` 的 `2px` 蓝色焦点环。

### 动效（Motion）规范

- **时长与缓动**：所有微交互过渡（行悬停背景切换、按钮状态变化、边框变色）时长严格控制在 **`120ms`–`200ms`** 之间，统一使用 **`ease-out`**（`cubic-bezier(0.33, 1, 0.68, 1)`）。
- **禁止弹跳与过度缩放**：严禁使用弹簧/弹跳（bounce/spring）曲线，严禁任何元素在悬停或激活时发生超过 `1.02` 的 `scale` 缩放（表格行、按钮、卡片一律禁止缩放）。
- **视觉回归测试与无障碍降级**：
  - 全局响应 `@media (prefers-reduced-motion: reduce)`，将过渡与动画时长降为 `0ms`。
  - 在 Playwright 视觉回归测试（`playwright.config.ts`）中，默认配置 `expect.toHaveScreenshot.animations: 'disabled'` 彻底禁用动画。

---

## Do's and Don'ts

### 必须遵守（Do's）

- ✅ **用 `canvas.subtle`（Light `#f6f8fa` / Dark `#161b22`）做悬停背景**：应用于文件列表行、提交时间线项、下拉菜单项与次级导航。
- ✅ **用 `1px solid` 边框与 `8px` 基准间距做分隔**：使用 `#d0d7de`、`#d8dee4`、`#e1e4e8`（Dark 模式 `#30363d`、`#21262d`）及 `4 / 8 / 12 / 16 / 24 / 32px` 间距组织 `Box` 与页面结构。
- ✅ **所有颜色从语义 token 引用，不写新 hex**：组件与页面 CSS 只允许引用 `var(--bgColor-*)`、`var(--fgColor-*)`、`var(--borderColor-*)` 等桥接变量。
- ✅ **锁定 `14px` 正文基准字号与 `12px` 等宽代码字号**：保证与 GitHub 同等的信息密度与扫视效率。
- ✅ **确保所有可交互元素具备 `2px` 蓝色焦点环**：支持纯键盘完整遍历仓库导航、文件树、提交列表与 Diff 视图。

### 硬性禁令（Don'ts）

- ❌ **不用渐变做按钮或头部背景**：禁止任何 `linear-gradient` 或 `radial-gradient` 出现在按钮、顶栏、仓库头或卡片上。
- ❌ **不用 `box-shadow` 做悬浮卡片的主要深度手段**：容器深度靠 `canvas.*` 分层与 `1px solid` 边框表达，仅允许按钮静止态使用极轻阴影 `rgba(27, 31, 35, 0.04)`。
- ❌ **不引入与 Git 工作流无关的装饰性插图或动画**：不添加空状态插画、波浪背景、粒子动效或卡片悬浮抬升动画。
- ❌ **不把正文字号改成 `15px` 或 `16px`，不用全局覆盖样式剥离 `1px` 边框**：彻底清理类似 `enterprise.css` 中放大字号、抹除 `.panel`/`.list` 边框的规则。
- ❌ **不新增无后端支撑的假 UI 模块**：只改造 CloudForge 现有 Git 托管与协作流程，不伪造未实现的功能入口。
