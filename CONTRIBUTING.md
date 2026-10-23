<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE). -->

# Contributing to CloudForge

Thanks for your interest in contributing.

## Licensing of contributions

This project is distributed under the **GNU GPL v3 or later** (`COPYING`), on top of the
Apache-2.0 licensed upstream work (`LICENSE`). There is no CLA.

By opening a pull request you agree that your contribution is licensed under GPL-3.0-or-later,
and that you have the right to license it. Please sign off every commit (`git commit -s`):

    Signed-off-by: Your Name <you@example.com>

## 提交信息（Commit messages）

所有提交信息都用**中文**，与 MagirecoCN legacy-client 同一标准。`commit-msg` 和 `pre-push`
两道钩子硬拦（`scripts/githooks/`，`yarn install` 时由 husky 装好；pre-push 兜底那些不是在装了
钩子的克隆里产生的提交）：

1. **标题**是「type(scope): 中文描述」。type 只能是 `feat` `fix` `refactor` `docs` `test`
   `chore` `ci` `perf` `build`；scope 自选（actions / review / ui / installer / git …），可省略；
   破坏性变更在冒号前加 `!`。前缀之后的描述必须是中文：

   ```
   feat(actions): 新增 Secrets 与 Variables
   fix(review): 修复重试时评审状态被旧结果覆盖
   refactor(installer): 生成密钥改由 generatedSecrets 统一负责
   ```

2. **正文**用中文写清楚为什么改、怎么改、怎么验证的。一个逻辑改动一个提交。
3. **「文档:」**：正文里必须有一行交代文档，写明改了哪些，或明确写不影响，例如
   `文档: 已更新 docs/configuration.md 的 Secrets 表`、`文档: 纯内部重构，不影响任何文档描述`。
4. **署名**：作者固定为维护者身份（全局 git config 的 CNB noreply 邮箱），提交用 SSH 密钥签名，
   并用 `git commit -s` 加 `Signed-off-by`。实际执笔的 Agent 必须在末尾加完整的
   `Co-authored-by: Name <email>`，例如 `Co-authored-by: Claude <noreply@anthropic.com>`、
   `Co-authored-by: Codex <noreply@openai.com>`（钩子硬拦，「Co-authored-by: x」这种半截写法不算）。
5. git 自己生成的信息（`Merge`、`Revert`、`fixup!`、`squash!`）不检查。确需跳过时（修 typo、
   纯格式调整），在信息里**顶格独占一行**写 `[skip-hooks]`；用它意味着你明确知道自己在跳过什么。

## Getting started

1. Fork the repository and clone your fork.
2. `yarn install`
3. Follow [Local development](docs/development.md).

## Making changes

1. Branch from `main`.
2. Make your change, with Vitest coverage for backend behavior (`worker/src/__tests__/`).
3. `yarn format`, `yarn typecheck`, and `yarn test` — CI runs all three, plus `yarn build`.
4. If you changed the schema, run `yarn db:generate` and commit the generated migration.
   Never hand-write migration SQL or edit `worker/src/db/auth.schema.ts`.
5. Open a pull request describing what changed and why.

## Code style

- TypeScript strict mode in the Worker and the SPA.
- Hono + Zod OpenAPI routes; Drizzle for D1 queries; `db.batch` for multi-statement writes.
- The UI uses GitHub's Primer CSS classes; match the surrounding components.
- Tests never mock `env.DB`; use the in-memory Artifacts fake for git storage.

## Reporting issues

Open an issue with what you expected, what happened, and steps to reproduce.
