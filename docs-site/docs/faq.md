# 部署、认证与运行时排错 FAQ

本页汇总上线部署、本地开发、权限维护以及运行期内最常遇到的异常现象与排查思路。

## 安装器校验报错 "The API token cannot read: ..."

- **原因**：`CLOUDFLARE_API_TOKEN` 或登录用户缺少创建或读取某个绑定资源（例如 Artifacts、R2、D1、Containers 或 AI Gateway）的 Account 级别权限。
- **处理**：对照 [多模式部署与运维](/docs/deployment) 及源码仓库 `docs/setup.md` 的权限列表补齐 API Token 权限；安装器在规划阶段即拦截并终止，不会留下半成品写入。

## 为什么访问所有接口直接返回 `503 Service Unavailable`（`Cache-Control: no-store`）？

- **原因**：从 `runtime-bridge-v1` 起，Worker 在每个请求认证与 Git/LFS 解析前都会检查 D1 表 `access_runtime_state`。若迁移未完整执行、表/单例行缺失、数据库读取异常，或线上 Worker 代码版本低于当前数据库记录的最低协议版本，入口会主动 fail-closed 返回 503，而只有 `GET/HEAD /.well-known/cloudforge` 会继续返回不含机密的诊断元数据。
- **排查**：
  1. 在安装器或命令行核对远端 D1 是否已完成最新迁移：`pnpm dlx @cybernova2333/cloudforge status` 或 `pnpm exec wrangler d1 migrations list <db> --remote`；
  2. 如果刚刚在零停机/灰度期间回滚了旧版本 Worker，但数据库最低协议已经推进，需重新部署支持对应协议版本的新 Worker；
  3. 修改站点设置或权限后仍偶发失败，记住 Durable Objects 默认存在最长可达 300 秒（可配置）的代码延迟更新窗口，单次 HTTP 探针通过不代表所有后台 DO 已刷新。

## 管理员打开页面只看到强制 MFA 绑定页或丢失双因子设备

- **强制 MFA 受限通道**：一旦站点管理员在安全策略中启用强制 MFA，未启用 TOTP 的成员登录后在 `App.tsx` 的 `Gate` 会被锁定到受限安全页（`enroll_mfa`），并在完成绑定保存一次性恢复码前无法访问业务路由；旧的 PAT 和部署令牌不受浏览器验证码阻断，但新建令牌会被策略检查要求先通过近期认证。
- **遗失设备或忘记密码**：运行安装器提供的离线恢复子命令，均要求显式指定账号/库、交互预览确认并写入完整审计记录：
  - 密码恢复：`pnpm dlx @cybernova2333/cloudforge reset-password`
  - MFA 因子清空：`pnpm dlx @cybernova2333/cloudforge reset-mfa`（注意：离线恢复只会清除指定个人账户的绑定因子与恢复码，**绝不会**自动关闭实例级强制 MFA 策略）。

## 推送时 Git 客户端提示权限被拒或默认分支不能推送

- **使用部署令牌推送空仓库**：可写部署令牌（`cfd_`）禁止在“尚未存在默认分支”的空仓库里推送首个普通分支（防止后续把第一个普通分支自动提升为默认分支从而绕过保护边界）。请先由管理员推送或初始化默认分支。
- **强推/删除默认分支或 `refs/pull/*`**：除仓库管理员可快进推送默认及受保护分支外，其余协作者或部署令牌一律由 `push-protection.ts` 拦截；内部引用 `refs/pull/*` 对所有外部推送关闭。
- **私有仓库返回 `404` 而不是 `403`**：为避免泄露私有仓库是否存在，无读权限的请求在网页、API、Git 与 LFS 均统一应答 `404`。

## Actions 工作流一直处于 Queued 或提示规格超限

- 检查 **站点管理 → Settings → Actions**：`actions.max_runner_size` 是否小于工作流中 `runs-on` 请求的 `cloudforge-standard-N` 规格（注：`ubuntu-latest` 映射到 `standard-2`）。
- 若有单一仓库同时触发大量作业，检查是否触发 `actions.max_concurrent_jobs_per_repo` 或实例总额度 `actions.max_concurrent_jobs`；页面会显示当前队列前方的作业数量。
- 若启用了内置相关性门控 `cloudforge/relevance@v1` 却未跳过测试，请确认变更文件列表未落入共享路径规则，且模型调用配置（`AI` 绑定与 `SUMMARY_MODEL`）正常。

## `engine: pi` 审查显示退化为单轮 Pass 或报 2 小时超时

- **缺少 `AGENT_REVIEWER` 绑定**：当部署配置未声明 `AgentReviewer` Durable Object 时，Worker 会优雅降级为单轮 Pass 并记下提示。
- **预算耗尽或文件被略过**：深审受限于最多 3,000 个检出文本文件 / 24 MB 总大小以及单文件 512 KB（受 `.orangeignore` 过滤），可在 PR 摘要中检查 `/review/not-checked-out.txt` 或在站点设置调高 `review.pi_minutes`（最高 60 分钟）及工具/Token 上限；若超过 2 小时仍卡在运行态，每日定时恢复会自动收口为失败以便重新点选 Retry。
