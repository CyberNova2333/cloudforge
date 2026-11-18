---
repoGuideSource: repo-docs/code-map.md
---

<!--@include: ../../repo-docs/code-map.md-->

## 源码证据与验证入口

详细的双遍源码调查台账与读者模拟复核记录保存在仓库工程文档目录：

- [Git、Artifacts 与 LFS 模块](/docs/modules/git-and-storage)
- [AI 审查、堆叠与自动落地模块](/docs/modules/reviews-stacking-and-merge)
- [Actions 容器、状态与 Webhooks 模块](/docs/modules/actions-containers-and-webhooks)
- [身份认证、OIDC 与访问兼容内核模块](/docs/modules/auth-oidc-and-access)
- 仓库内完整证据台账：`repo-docs/references/source-evidence.md` 与 `repo-docs/references/quality-review.md`

## 本地开发与提交门禁

1. **工具链约束**：Node.js `>=22.18`、pnpm `12.6.0`（务必运行 `pnpm install --frozen-lockfile`）；不要提交未经过声明生成的散落 SQL 改动（D1 Schema 修改见 `scripts/database/generate-db.mjs` 与 `pnpm db:generate`）。
2. **代码与测试分层**：后端领域按功能域组织在 `worker/src/<域>/`，测试按域放在 `worker/src/__tests__/<域>/` 并必须登记到 `.github/workflows/ci.yml`（受 `ci-workflow.test.ts` 严格校验）。运行命令：

```bash
pnpm typecheck
pnpm test           # 先跑 Node/CLI Vitest（scripts/cloudforge/vitest.config.ts），再跑 workerd 真实 D1 测试
pnpm agents:sync --check
pnpm format:check
```

3. **Git 钩子规则（`.husky/`）**：
   - 提交标题必须使用中文 Conventional Commits（例如 `feat(actions): ...` / `docs(docs): ...`）；
   - 提交正文必须包含 `文档:` 交代和 `Co-authored-by:` trailer（校验规则见 `scripts/githooks/rules.mjs`）；
   - `pre-commit` 与 `pre-push` 运行 `tools/repo_maintenance_guard.py` 扫描凭证与敏感路径，并用 `lint-staged` 检查文件格式；
   - 基于上游 `choyiny/gitorange`（Apache-2.0）改编或新增的源文件按 `CONTRIBUTING.md` 与 `AGENTS.md` 保留或声明相应许可证头部。

- 一方源码及改编部分依据 `LICENSE`（AGPL-3.0-only）与根目录 `ADDITIONAL_TERMS.zh-CN.md`（英文参考 `ADDITIONAL_TERMS.en.md`）授权，独立品牌与字体/前端资产清单见 `ASSET_LICENSES.md`。
