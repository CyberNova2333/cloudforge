# 多模式部署与运维指南

CloudForge 提供四种常见落地与运行方式：零克隆的 npm 安装器 CLI、源码克隆后运行 `pnpm cloudforge`、手写 `wrangler.jsonc` 手动部署，以及本地全栈开发模式。所有生产部署均严格落在你自己的 Cloudflare 账户中，仓库源码、Secrets 与 AI 配额不经过第三方托管方。

## 模式一：官方安装器 CLI（推荐生产方式）

安装器位于 `scripts/cloudforge/`，打包发布为 `@cybernova2333/cloudforge`。它会交互式校验 Cloudflare 账号与 API 权限、自动创建 D1 / R2 / Artifacts 资源、生成配置、执行 `migrations/` 下的 67 个迁移并部署 Worker，同时把安装记录保存在本机（而非写入共享代码仓库）。

```bash
# 1. 全新安装一个 CloudForge 实例（无需先 clone 代码仓库）
pnpm dlx @cybernova2333/cloudforge install

# 2. 如果你已经 clone 了仓库，可在仓库根目录执行等价入口：
pnpm cloudforge install
```

部署完成后，访问实例首页会自动重定向至一次性初始化页面 `/setup`，使用 CLI 创建或配置的首位管理员凭证创建站点管理员账号，随后即可在 **站点管理 → Setup** 检查绑定状态与待修补项。

### 常用维护与恢复子命令

| 命令                                                | 作用说明                                                                       | 典型使用时机                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| `pnpm dlx @cybernova2333/cloudforge status`         | 查看已记录安装的目标账号、Worker 与线上迁移/状态诊断                           | 检查当前运行版本或确认实例归属         |
| `pnpm dlx @cybernova2333/cloudforge upgrade`        | 对比目标协议与迁移指纹，先跑只读预检，再按确认计划升级 D1 与 Worker            | 拉取新版本或恢复中断的升级             |
| `pnpm dlx @cybernova2333/cloudforge adopt`          | 接管此前手动部署、未通过安装器建立本地状态文件的已有实例                       | 从手工 `wrangler.jsonc` 迁移到统一运维 |
| `pnpm dlx @cybernova2333/cloudforge reset-password` | 离线重置指定成员密码与清理会话（需显式确认目标，不弱化 MFA 策略）              | 管理员或成员遗失本地密码时             |
| `pnpm dlx @cybernova2333/cloudforge reset-mfa`      | 离线预览并清除指定成员的双因子绑定与恢复码（保留完整审计与策略边界）           | 最后管理员设备遗失时救急恢复           |
| `pnpm cloudforge access-preflight`                  | 只读检查 D1 兼容结构（`legacy` / `compat-v1` / `runtime-bridge-v1`）与阻塞异常 | 准备未来多团队权限迁移前核查数据一致性 |
| `pnpm cloudforge access-drain-status`               | 只读观察六类 D1 在途任务（Actions/Runner/Agent/push_events 等）计数与样本      | 发布切换或排空窗口前确认当前任务存量   |

::: warning 发布刚出新版本时
若 `pnpm dlx` 命中本地旧缓存，请附加 `--prefer-online` 参数再执行；所有在线操作均支持 `--name <实例名>` 区分多实例。
:::

## 模式二：手动配置 `wrangler.jsonc` 与 Cloudflare 权限要求

如果你希望纳入团队自建流水线手动执行 `wrangler`，请从根目录复制 `wrangler.jsonc.example` 为 `wrangler.jsonc`，手动创建 D1、三个 R2 存储桶与 Artifacts 命名空间，并执行：

```bash
pnpm build
pnpm exec wrangler d1 migrations apply <你的D1库名> --remote
pnpm exec wrangler deploy
```

无论使用安装器还是自定义 `CLOUDFLARE_API_TOKEN` 流水线，Cloudflare API Token 都必须具备与资源对应的一组账号及区域权限（具体权限清单维护在 `docs/setup.md`）：

- **Account 级权限**：Workers Scripts（Edit）、Workers Tail（Read）、Workers R2 Storage（Edit）、D1（Edit）、Containers（Edit）、Workers AI（Read）、AI Gateway（Read/Edit，若启用网关）、Cloudflare Artifacts（Edit）、Workers Observability / Analytics（Read，若开启成本统计）。
- **Workers Builds / Email / Zone 级权限（按需）**：若配置自定义域名需要对应 Zone 的 Workers Routes（Edit）与 DNS（Edit）；若开启邀请与通知邮件需要 Email Sending 授权；若使用 Cloudflare R2 预签名接口需要绑定 S3 兼容密钥（`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`）。

## 模式三：本地全栈开发（`pnpm dev`）

本地开发无需连接生产库，通过本地 Vite + Miniflare 模拟 D1 并按开发环境变量连接云端辅助服务：

```bash
# 1. 安装工作区依赖（Node >= 22.18, pnpm 12.6.0）
pnpm install --frozen-lockfile

# 2. 复制本地环境变量与配置模板
cp wrangler.jsonc.example wrangler.jsonc
cp .dev.vars.example .dev.vars

# 3. 写入本地 D1 迁移并启动全栈开发服务（默认 http://localhost:8080）
pnpm db:migrate:local
pnpm dev

# 4. 可选：灌入带 PR 堆叠、审查意见与工作流历史的演示数据
pnpm seed:demo
```

::: tip 开发内存提示
本地 `pnpm dev` 同时加载前端编译与本地 `workerd` 沙箱，`scripts/development/dev.mjs` 默认以安全内存上限拉起进程；请勿随意忽略 `.dev.vars` 中的 `BETTER_AUTH_SECRET`（至少 32 字节）与 `SECRETS_ENCRYPTION_KEY`。
:::
