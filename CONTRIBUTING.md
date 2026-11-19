<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Contributing to CloudForge

Thanks for your interest in contributing.

## Licensing of contributions

This project is distributed under the **GNU Affero General Public License v3.0 (AGPL-3.0-only)** (`LICENSE`), on top of the
Apache-2.0 licensed upstream work (`LICENSES/Apache-2.0.txt`). There is no CLA.

By opening a pull request you agree that your contribution is licensed under AGPL-3.0-only,
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
4. **署名**：作者固定为维护者身份（GitHub noreply 邮箱），提交用 SSH 密钥签名，
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

## 贡献许可与附加条款约定 / Contribution Licensing & Additional Terms

依据 `LICENSE-ADDITIONAL_TERMS-zh-CN.md`（v1.6.7-r4）第 1.7—1.9 款，向本项目提交拉取请求（PR）、补丁或其他贡献时，你须确认对所提交内容享有合法授权权利并同意按对应基础许可证（第一方原创代码为 [GNU AGPLv3](LICENSE)）提供。如你希望将个人享有版权的贡献纳入 [`LICENSE-ADDITIONAL_TERMS-zh-CN.md`](LICENSE-ADDITIONAL_TERMS-zh-CN.md)（英文参考：[`LICENSE-ADDITIONAL_TERMS-en.md`](LICENSE-ADDITIONAL_TERMS-en.md)，实施指南：[`IMPLEMENTATION-GUIDE.zh-en.md`](IMPLEMENTATION-GUIDE.zh-en.md)）适用范围，请在 PR 说明或可核实记录中**分别明确声明**对附加要求以及对第 9.5–9.6 款有条件附加许可的授权范围；未作明确声明的贡献将如实记为 `[附加条款：未发表意见]` 并按原适用基础许可证处理。引入第三方组件或附带独立图标、美术、字体资产的，须按 [`ASSETS_LICENSES.md`](ASSETS_LICENSES.md) 如实登记来源、原始作者与有效许可原文。既有上游或第三方多许可组件（如内核 GPLv2、上游 MIT / Apache-2.0 / GPL-2.0-or-later 代码）保留其各自原有许可。

Pursuant to Sections 1.7–1.9 of [`LICENSE-ADDITIONAL_TERMS-zh-CN.md`](LICENSE-ADDITIONAL_TERMS-zh-CN.md) (v1.6.7-r4; English reference: [`LICENSE-ADDITIONAL_TERMS-en.md`](LICENSE-ADDITIONAL_TERMS-en.md); implementation guide: [`IMPLEMENTATION-GUIDE.zh-en.md`](IMPLEMENTATION-GUIDE.zh-en.md)), submitting a pull request, patch, or other contribution confirms that you hold the requisite rights to license your submission under the applicable base license ([GNU AGPLv3](LICENSE) for first-party code). Express authorization for the Additional Requirements and for the conditional additional permission in Sections 9.5–9.6 is verified separately: please state your covered materials and consent scope explicitly in the PR or a verifiable record; submissions without an express verifiable statement are recorded as `[Additional terms: No recorded position]` and remain governed by their base license. Any third-party components or standalone artwork, fonts, or icons must be truthfully documented in [`ASSETS_LICENSES.md`](ASSETS_LICENSES.md). Pre-existing upstream or third-party components retain their respective original licenses.

<!-- repo-maintenance:begin -->

## 提交与核验 / Commits and verification

先阅读 [Agent 操作约束](AGENTS.md)、[项目指南](repo-docs/README.md) 和 [安全说明](SECURITY.md)。项目自己的兼容性、测试、署名与签名要求继续适用。

Use the project instructions, living guide and security policy before changing code. Existing compatibility, testing, attribution and signing requirements remain authoritative.

提交标题采用 `type(scope): 描述`，`scope` 可省略；允许 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`、`data`。标题不超过 100 个字符；仓库规定中文或更严格的类型集合时，遵守该仓库要求。正文解释原因、影响、实际验证结果和文档影响。一条提交对应一个可审阅的主题，签名和参与者尾注按真实身份填写。

Use Conventional Commits, with an optional scope and a subject of at most 100 characters. Follow stricter repository rules, including Chinese subjects where required. Explain the reason, effect, actual verification and documentation impact in the body. Attribute the real participants and retain the configured signing identity.

```sh
python tools/repo_maintenance_guard.py install
python tools/repo_maintenance_guard.py status
python tools/repo_maintenance_guard.py pre-commit
```

安装只修改当前克隆的 Git 配置。已有钩子会继续执行；新克隆需要重新安装。提交模板位于 `.gitmessage.txt`，已有自定义模板不会被覆盖。Git 钩子需要 Python 3.10+，不可完成检查时阻止本次操作并说明原因。项目自身的构建与测试命令见 README 和指南，安全扫描通过不代表业务测试通过。

Installation changes only this clone's Git configuration. Existing hooks continue to run. Install again in each fresh clone; an existing commit template is retained. Python 3.10+ is required. A failed security check stops the operation. Run the build and tests documented by this repository; passing the security scan does not establish application correctness.

历史信息整理仅用于维护者明确授权的场景。改写会改变提交编号；保持作者、提交者、日期、文件树与父图关系，保留原始引用和映射，并重新验证签名。发布改写后的历史需要独立核对远端引用与协作者状态。

Rewriting history requires an explicit maintenance request. Preserve identities, dates, trees, graph relationships and recovery references, then verify new signatures. Review remote state and collaborator impact separately before publishing rewritten history.
<!-- repo-maintenance:end -->
