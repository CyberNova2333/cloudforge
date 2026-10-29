# CloudForge：一次真实主流程

成员向仓库推送一条分支时，平台必须同时守住仓库权限、Git 引用保护和后续任务的可恢复性。本指南沿这次推送解释代码托管的一条主路径，帮助维护者区分“对象已写入”和“后续处理已完成”。

下面的 case 是依据源码分支整理的代表性输入与结果，不是本轮线上观测。

| 输入或状态                 | 动作与结果                                 |
| -------------------------- | ------------------------------------------ |
| 有写权限的成员推普通分支   | 保护检查通过后转发；实际成功的引用登记事件 |
| 只读令牌推送               | 写入权限检查拒绝                           |
| 部署令牌对未初始化仓库推送 | 拒绝引导默认分支                           |
| 存储完成而后台中断         | 事件保留，恢复器可重试                     |

## Step 1: 请求先取得仓库权限

成员通过 Git 客户端向仓库的 HTTPS 地址推送，令牌作为 Basic 密码。入口识别仓库和操作，按当前用户、令牌范围及仓库权限决定是否允许写入。公开仓库可以匿名读取，推送仍需凭据；只读令牌不会因为所属成员能写就获得写权限。

[对应实现](../../worker/src/git-http.ts)，定位 `authenticateRepoRequest、handleGitRequest`。

## Step 2: 引用变动先经过保护

输入的包还不能直接送去存储。入口先解析 receive-pack 命令，保护默认分支、受保护分支和内部引用；不合格的更新返回 Git 的拒绝结果。部署令牌另有边界：仓库管理员必须先初始化默认分支，部署凭据不能借首次推送成为默认分支。

[对应实现](../../worker/src/git/push-protection.ts)，定位 `decidePush；在入口中搜索 readReceiveRequest 与 deployToken`。

## Step 3: 存储回复决定哪些更新成立

允许的更新交给 Artifacts；服务器端的仓库凭据留在 Worker。回复支持状态报告时只采纳成功的引用，否则重新读取引用核对目标值。因此 HTTP 成功不能直接解释为每条引用都更新成功。

[对应实现](../../worker/src/git-http.ts)，定位 `successfulPushRefs、applied、recordPush`。

## Step 4: 先记事件，再返回推送结果

只要存在实际生效的引用，平台先把更新写入 D1 的推送事件，再安排后台后续工作并返回 Git 回复。这样响应后的执行被截断时仍有恢复依据。事件会触发配置刷新、检查、状态更新等工作，但这些工作的业务细节不在本指南范围内。

[对应实现](../../worker/src/lib/push-events.ts)，定位 `recordPush、afterPush、runPushEvent`。

## Step 5: 中断后按事件恢复

恢复按租约和尝试次数领取未完成事件，成功后标记完成；失败释放领取状态，留待下一次推送或定期恢复。后续处理需要允许重复执行，不能把一次后台调用当作唯一交付凭据。

[对应实现](../../worker/src/__tests__/push-events.test.ts)，定位 `“后台被中断的事件”与“同一仓库的下一次推送”用例`。

## 检查这条解释

```sh
yarn test:workers worker/src/__tests__/git-http.test.ts worker/src/__tests__/push-protection.test.ts worker/src/__tests__/push-events.test.ts
```

上述定向命令只验证 Git 主流程；全项目要求仍以根 AGENTS 和 docs/development.md 为准。本轮只运行文档校验与文档站构建，不运行 workerd、迁移或真实推送。

理解这条交接后，用[代码地图定位下一次修改](../code-map.md)；需要反查依据时查看[源码调查与边界证据](../references/source-evidence.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
