<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Git 传输、Artifacts 隔离与对象存储

CloudForge 不在 D1 中存放 Git blob、tree 或大文件二进制，也不自建 SSH 守护进程；每一次克隆、推送与 LFS 传输都必须走 Worker HTTP 边缘入口，先过权限、协议准入与引用保护，再把 Git 对象交给 `Cloudflare Artifacts`、把大二进制直传至 R2。理解这一划分是看懂 [一次真实主流程](../walkthroughs/one-real-run.md) 中“对象写入”与“D1 事件交接”分离的前提。

## 为什么传输层与存储层必须分界

Git 客户端通过 HTTPS 向 `/<owner>/<repo>.git/*` 发起 Smart HTTP 或 LFS Batch 请求，入口 `worker/src/index.ts` 会先分流到 `worker/src/git/http/handler.ts` 与 `worker/src/lfs/http/handler.ts`。服务端把持上游 `ARTIFACTS` 命名空间与 R2 S3 签名凭据：客户端持有的个人访问令牌（PAT）或前缀 `cfd_` 的部署令牌永远不会转发给上游存储，Worker 仅在鉴权通过后在内存内向 `Cloudflare Artifacts` 换取单次短期凭据，或为 LFS 对象签发有效期 15 分钟的 R2 预签名 URL。

```sh
# 使用部署令牌或个人访问令牌通过 HTTPS 推送（LFS 复用同一组凭据）
git clone https://deploy:<cfd_token>@<host>/<owner>/<repo>.git
```

这一分离带来两个硬约束：Workers 无法监听 22 端口，因此平台不提供 SSH；新建的 Artifacts 仓库受上游平台限制为 1 GB 上限且使用 Git 协议 v1，超过体积适合的二进制资产必须走 Git LFS 落入 R2（路径 `lfs/<repository_id>/<oid>`，上传校验 `x-amz-checksum-sha256` 并由 `worker/src/lfs/http/handler.ts` 在 `verify` 后写入 `lfs_objects`）。

## 引用保护与推送事件的异步边界

receive-pack 请求到达时，`worker/src/git/push-protection.ts` 的 `decidePush` 会在转发给 Artifacts 前逐条检查 ref 更新：默认分支、受保护分支禁止强推和删除，普通协作者或可写部署令牌不能覆盖默认/受保护分支，任何外部身份均禁止推送内部 `refs/pull/*`。对于部署令牌，`worker/src/auth/deploy-tokens.ts` 还会额外核验创建者当前未封禁且仍保留仓库管理权，且明确要求仓库必须先由管理员初始化默认分支。

| 推送场景                                       | 准入与保护判定               | 实际结果与边界                                              |
| ---------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| 管理员向受保护默认分支快进推送                 | 权限与 `decidePush` 通过     | 转发 Artifacts；按成功回执写入 `push_events` 并更新默认分支 |
| 只读 PAT 或只读部署令牌发起 `git-receive-pack` | 在入口鉴权阶段直接拒绝       | 返回 HTTP 403，请求不到达 Artifacts                         |
| 可写部署令牌向空仓库推送首个分支               | 缺少已有默认分支，被边界拒绝 | 拒绝提升首个普通分支为默认分支，需管理员先初始化            |
| 写入 Artifacts 成功但响应后 `waitUntil` 中断   | `recordPush` 已先写入 D1     | 保留 `push_events` 记录，后续推送或恢复任务按租约重试       |

由于 `Cloudflare Artifacts` 与 D1 之间不存在跨服务两阶段事务，`worker/src/git/push-events.ts` 采取“写入确认后、返回 HTTP 响应前记录 `push_events`”的策略。同仓库的默认分支自动采用也采用条件更新：仅当 D1 中的默认分支在读取前未变化时才写入候选分支，避免覆盖管理员在并发等待窗口中手动保存的新默认值。所有跨模块职责定位可回到 [代码地图](../code-map.md) 继续查找，权限矩阵细节则衔接 [身份认证、OIDC 与访问边界](auth-oidc-and-access.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
