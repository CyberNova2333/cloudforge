<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Local development

## Prerequisites

- Node.js v22.18+ and yarn
- `yarn wrangler login` on a Cloudflare account on Workers Paid (Artifacts is in open beta there). Artifacts has no local emulator, so `yarn dev` talks to the real service (namespace `cloudforge-dev`). D1 is local.

Mermaid 12 requires an ES2024-capable browser (including Safari 17.4+). Diagrams explicitly use the Dagre layout
and classic appearance to retain their existing presentation. React Router 7 keeps the declarative routing API.
The Yarn resolutions for Vite, Undici, Sharp, and Drizzle's transitive esbuild pin patched dependency versions;
review the resolved dependency graph and run `yarn audit` when changing them.

## First run

```bash
yarn install
cp wrangler.jsonc.example wrangler.jsonc   # set account_id and env.dev values
cp .dev.vars.example .dev.vars             # set BETTER_AUTH_SECRET (and R2_* for Git LFS)
yarn wrangler r2 bucket create cloudforge-lfs-dev   # only if you'll use Git LFS locally
yarn db:migrate:local
yarn dev                                   # http://localhost:8080
```

The app, API, and git endpoint share one origin: `git clone http://localhost:8080/<owner>/<repo>.git`.

## Scripts

| Script                                           | What it does                                                                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`                                       | Vite dev server running the Worker in `env.dev`, under a memory watchdog (below)                                                                                                                                 |
| `yarn seed:demo`                                 | Fills a running local instance with demo data (see below)                                                                                                                                                        |
| `yarn test`                                      | Vitest inside workerd against a real local D1, with an in-memory Artifacts fake; test files spread over parallel workers (`TEST_WORKERS`, default half the cores, at most 8)                                     |
| `yarn test:workers [files/flags]`                | Worker/pure frontend tests only, through the same runtime-diagnostic exit-status guard used by `yarn test`; accepts Vitest file filters and `--shard=1/2`                                                        |
| `yarn typecheck`                                 | Type-checks the SPA and the Worker                                                                                                                                                                               |
| `yarn format` / `yarn format:check`              | Prettier                                                                                                                                                                                                         |
| `yarn db:generate`                               | Generate a migration after changing the Drizzle schema (never hand-write migrations)                                                                                                                             |
| `yarn auth:update`                               | Regenerate `worker/src/db/auth.schema.ts` after changing the better-auth config                                                                                                                                  |
| `yarn cf-typegen`                                | Regenerate `worker/worker-configuration.d.ts` from `wrangler.jsonc.ci`                                                                                                                                           |
| `yarn agents:sync`                               | Generate the `CLAUDE.md` entry point importing the canonical `AGENTS.md`, and `.agents/skills/` copies from `.claude/skills/`; never overwrite `AGENTS.md`                                                       |
| `yarn cloudforge access-preflight --name <name>` | Read-only legacy-access snapshot and compatibility diagnostics; no migration or role publication. Manual deployments require `--database` plus `--account`; see [updating](updating.md#legacy-access-preflight). |

## OIDC linking and sign-in checks

OIDC uses its own protocol, D1 actions and explicit identity bindings. Linking never creates a session; the separate native sign-in plugin grants an SDK session only after final D1 authorization and required local MFA. It does not register a Better Auth social provider. Keep `OIDC_PROVIDER` empty unless deliberately configuring it; `loginEnabled` defaults false and needs higher-version administrator publication. Keep `OIDC_CLIENT_SECRET` in secrets rather than JSON vars. See [configuration](configuration.md#oidc-identity-linking) and [the flows](oidc.md).

```bash
yarn test:workers worker/src/__tests__/oidc-linking.test.ts worker/src/__tests__/oidc-provider.test.ts worker/src/__tests__/oidc-sign-in.test.ts worker/src/__tests__/oidc-session-source.test.ts worker/src/__tests__/session-secret-cache.test.ts
yarn test:workers src/lib/oidcApi.test.ts src/lib/oidcSignInApi.test.ts src/lib/signInLock.test.ts
```

The backend suites use real workerd D1 and WebCrypto; external metadata/JWKS/token HTTP may use controlled fixtures, not a mock database or a replacement protocol module. Cover final SQL authorization, immutable identities, configuration generation, one-use callbacks, separate per-action cookies, candidate confirmation and cancellation. Also test published retirement (`enabled=false`) against old Workers and in-flight actions, including an invalid/missing deployed configuration or secret, safe status/read/revoke fallback, and higher-version reactivation, retired-digest invalidation and the independent confirmation-trigger fence. Clearing an environment variable is not a substitute for a D1 revocation generation. Protocol checks must also reject missing/invalid claims, malicious endpoints and keys, redirects, oversized bodies and timeouts. Cross-request cache validation needs separate real HTTP invocations; concurrent promises in one test do not establish Workers request isolation.

Sign-in checks must also cover strict anonymous Origin, `__Host-` proof cookies, candidate confirmation, optional-policy local MFA, one-use factors, generation changes during exchange/issuance and immutable source inheritance across real password reauthentication and session replacement. No SSO/IdP timestamp may satisfy recent local-password rules. Key rotation must invalidate a signature memo even in a reused isolate; continuous hits cannot extend old-key acceptance.

Actual browser fixtures cover Domain-cookie injection, Web Locks across tabs, pagehide/bfCache, stale responses and unknown completion receipts. Unsupported browsers retain password login; the lock coordinates normal same-origin password/MFA and SSO UI, not every native automatic login flow (such as email verification), and is not a server authorization guarantee for arbitrary raw HTTP races. Fixtures do not establish real IdP interoperability. Run full `yarn test`, `yarn typecheck`, generation and formatting checks before integration. A generator printing types is not success until exit zero. Deployment, production migration and real IdP verification remain separate.

## Codex 与 Git 钩子

Git 的 `pre-commit` 使用 `scripts/githooks/run-yarn.mjs` 运行 lint-staged。优先使用已有 Yarn，
找不到时通过 Corepack 运行 Yarn；Windows 的标准 `.cmd` 启动器会解析为 Node 入口，文件名等参数
直接传递，不经过 shell 拼接。Yarn 执行失败会原样失败，不重试或跳过检查。只装了 Corepack 的环境
也可以用 `corepack yarn install`、`corepack yarn husky` 和 `corepack yarn typecheck`。

Codex 从 `.codex/hooks.json` 加载以下检查，与 Claude 共用 `.claude/hooks/hooks.config.json`：

- `PreToolUse`：解析 `apply_patch` 的所有路径（含删除与重命名两端），阻止直接编辑生成文件。
- `PostToolUse`：逐个格式化补丁触及的现存文件，并检查真实的集中运行或跳过测试调用。
- `Stop`：运行类型检查；启动失败、超时或检查失败都会反馈，`stop_hook_active` 避免重复阻止结束。

入口通过 Git 定位仓库，支持从子目录启动及路径中的空格。配置命令支持参数数组；参数包含空格时
应使用数组，不要依赖 shell 引号或变量展开。钩子不读取会话记录，也不保存工具负载。
Shell 或其他工具写入文件不会触发这组 `apply_patch` 编辑检查；提交前仍需运行格式化、类型检查和测试。

按 [Codex 官方钩子文档](https://learn.chatgpt.com/docs/hooks)，新增或修改的项目钩子需要在 `/hooks`
中审阅并信任后才会运行；仓库配置不会替用户修改全局信任设置。接入或升级后可执行下列回归检查：

```bash
yarn vitest run --config scripts/cloudforge/vitest.config.ts scripts/__tests__ scripts/githooks/__tests__
yarn agents:sync --check
```

## Layout

```
src/                 React SPA (Primer CSS, react-router, TanStack Query)
worker/src/
  index.ts           Worker entry: Hono app + git endpoint
  git-http.ts        git smart-HTTP proxy to Artifacts
  git/               pkt-line, object encoding, packfiles, merge/diff service
  routers/           API routes (Hono + Zod OpenAPI)
  db/                Drizzle schema (auth.schema.ts is generated)
  auth/              better-auth config and guards
  oidc/              Explicit linking/sign-in protocol, D1 actions and native session bridge
  __tests__/         Vitest suites and the Artifacts fake
migrations/          Generated D1 migrations
```

API docs are served at `/api/swagger-ui` while running, to signed-in members (better-auth's at `/api/auth/reference`).

## Demo data

`yarn seed:demo` fills a running local instance with a project to look at: a teammate (`cho`, Cho Yin), an `invoices`
repository with ten days of history, eight merged pull requests (three with their branches left behind), six open ones
(one stacked on another, opened by Claude Code, Codex and by hand), the reviewer crew with a finding in each state
(an owner question, a change request, one assigned to `cho`, one decided by CloudForge AI), and a week of test runs.
It gives the pages of the redesign something to show, and makes a local demo possible; a page that is still being built
shows nothing new until it lands, though the API route behind it already answers (the script prints both).

```bash
yarn db:migrate:local                          # the local database must be current
yarn dev                                       # in one terminal; sign in once and create the first admin
SEED_ADMIN=<admin username> SEED_PASSWORD=<their password> yarn seed:demo --url http://localhost:8080
```

A run takes about ten minutes: opening each pull request starts CloudForge's usual background AI work (stack discovery),
and the script waits for it to settle.

- **Run it from the checkout `yarn dev` runs from.** The API cannot write reviews, backdated dates or test runs, so the
  script writes those rows into that checkout's local D1 with `wrangler d1 execute DB --local --env dev`. Before it
  creates anything it checks that this D1 holds the same admin the server at `--url` signed in, and stops if not.
- **Local only.** It refuses any URL whose host is not `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` or `*.test`.
- **It uses the real services in the `cloudforge-dev` namespace** (Artifacts and Workers AI), as `yarn dev` does: it creates
  the `invoices` repository and the crew's repositories, pushes the history over git, and opens and lands pull requests
  through the API.
- **Running it again finds the demo and stops.** `--reset` deletes the `invoices` repository (and its git storage, for
  good) and builds it again, but only a repository that this script built: its description and first commit (or the marker
  it writes last) must match, or it refuses. `--dry-run` builds the git history in a temporary folder and checks the SQL
  against the migrations, touching no server.
- `cho` gets the password in `SEED_TEAMMATE_PASSWORD`, or the local demo default at the top of `scripts/seed-demo.mjs`.
  Nothing else is printed or stored: the admin's password is only used to sign in (and is not passed to wrangler), and the
  git token it creates is deleted right after the last push (or on Ctrl-C). Only what the run itself creates is backdated;
  a teammate, agents or tokens that were already there keep their dates.
- The agents do not really run: their reviews and findings are written directly, as they would have been. Containers are
  off locally, so the demo's test runs are written the same way.

## CI

Authentication schema generation uses the project-local `auth@1.7.7` through `yarn auth:update`.
The CLI and its dependencies are recorded in `yarn.lock` and included in `yarn audit`; generation does not download a separate tool tree. The retired `@better-auth/cli@1.4.21` is no longer used.
The generation-only profile in `scripts/auth-schema-config.ts` preserves seven existing nullable OAuth columns and the existing absence of a client-credentials JSON default. It does not change runtime plugin validation or export an HTTP handler. Unexpected upstream changes to these exact fields stop generation. The newer client/resource compound uniqueness and relation definitions are retained; the index is generated separately without rebuilding OAuth tables. Tightening populated columns needs a separate data and D1 foreign-key migration design.
The tool reads the installed SDK's schema. Private evidence fields have both `input: false` and `returned: false`; the latter
also removes fields from the native internal session result, so version guards read the raw fields from D1.
Do not replace that check with a type assertion or treat session refresh timestamps as verification.

`yarn db:generate` runs Drizzle and generates managed recovery triggers from
`worker/src/db/recovery-trigger.ts`. The generated `migrations/meta/_triggers.json` records their hashes;
its leading underscore keeps Drizzle from treating it as a schema snapshot. Only a migration created by the
current invocation receives trigger SQL. A trigger-only change creates a new custom migration automatically;
table migrations reapply the managed declarations so a SQLite table rebuild cannot silently remove them.
Never edit generated SQL or append a trigger to an old migration. The recovery CLI validates the installed
trigger definition and refuses missing or altered definitions.

Worker tests run through `scripts/test-workers.mjs`. The installed workerd/Vitest integration can emit an
uncaught RPC teardown exception after a passing summary and still exit zero. The wrapper streams the raw output
and makes those confirmed runtime diagnostics fail the command; it never converts a nonzero exit into success.
Use `yarn test` or `yarn test:workers`, including for file filters and shards. A single worker can reduce file-boundary
teardown races but does not eliminate them. Preserve failing logs and fix or drain unfinished background work;
increasing a timeout or accepting the summary alone is not a passing verification.

On [CNB](https://cnb.cool/CyberNova2333/cloudforge), [`.cnb.yml`](../.cnb.yml) runs format, typecheck, build and every test in one pipeline on each push and pull request: the tests on six workers of the runner's 8 cores (`TEST_WORKERS=6`), with `node_modules` and the yarn cache kept on the build node (copy-on-write volumes). GitHub and CloudForge instances read the workflows below instead.

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) builds and typechecks once (`build`), then runs the tests in one job per module (`test-stacking`; `test-review`, which also covers merging and agent runs; `test-actions`, which also covers the git endpoint and LFS; `test-core`, which also covers MCP and the client-side libraries), in parallel, from the build's cache. Modules are few and balanced by runtime, because each job pays to restore the build and start vitest. On CloudForge, `build` and the test jobs run on `cloudforge-standard-4` (`runs-on` is an expression that picks `ubuntu-latest` on GitHub). GitHub's actions are pinned to commit SHAs (their version in a comment), and the runner image's base and CNB's build image to digests; Dependabot on GitHub proposes new ones. On CloudForge a `gate` job asks [`cloudforge/relevance@v1`](ci-relevance.md) which modules a change can affect and skips the rest; on GitHub the gate is skipped and every module runs.

Every test file belongs to exactly one module. When you add a test file, add it to the `yarn test` line of its module's job; `worker/src/__tests__/ci-workflow.test.ts`, which `build` always runs, fails until you do. A new module needs a `test-<name>` job, a line in the gate's `modules`, and a `run-<name>` gate output. Tests get 30 s each when `CI` is set (CloudForge Actions, GitHub and CNB all set it) or more than one worker runs, 60 s when both (on CNB's six workers a few files run up to 14 times slower than alone), 5 s on a single local worker; on CI only failing tests print their console output, so CNB's 100 KB stage log keeps the failures and the summary. Tests are offline: `worker/test/setup.ts` refuses a fetch to any host but this machine at once (a real attempt can hang on a CI runner's TLS handshake and fail after its file, while the worker shuts down); a test that needs a response stubs `fetch` itself. A test also ends only when the work it handed to `ctx.waitUntil` ends: `worker/test/setup.ts` drains it after each test (up to 5 s), so it can neither write into the next test's emptied tables nor run into its worker's shutdown. That margin is about ten times a laptop's speed, so seed fixtures in bulk (one `db.batch`, as `releases.test.ts` does with `landedMany`): a loop of a hundred separate D1 writes takes minutes on CI and times the test out.

## Dev server memory watchdog

`yarn dev` runs Vite through [`scripts/dev.mjs`](../scripts/dev.mjs), which adds up the memory of the whole dev
process tree (Node, workerd, esbuild) every 5 seconds. It logs each time usage passes another gigabyte and stops
the server, with a breakdown by process, once it passes **5 GB**, so a leak can't take the machine down. The
server uses about 1.3 GB right after starting. Change the limit with `DEV_MEMORY_LIMIT_MB=8192 yarn dev`, or turn
the watchdog off with `DEV_MEMORY_LIMIT_MB=0`. A stop for memory exits with code 137.

## Access-schema maintenance checks

After a declaration change, `yarn db:generate` owns both managed triggers and append-only one-time data declarations. Existing migration files are never edited. Keep `_triggers.json` and `_data.json`; changing, removing or reordering a recorded backfill is refused. A second generation with unchanged declarations must leave every migration/metadata hash unchanged. Logic-only auth changes still run `yarn auth:update`; compare the generated auth schema rather than inferring no schema change.

The Worker tests keep the access singleton while deleting ordinary fixture subjects through production triggers. Its generation is not reset. Separate local-only D1 bindings hold pre-migration anomaly fixtures and populated upgrade/failure cases; the normal application DB always retains the new guards. Legacy `access-preflight` fixtures stop at migration 0062 and explicitly test refusal of the compatible schema. No test disables production triggers to manufacture a passing result.

Namespace guards include source-table `lower(...)` checks as a safety backstop. Their low-frequency writes may scan members; a 129-row fixture proves bounded parameters and consistency, not constant-time throughput. Add expression indexes only through reviewed declarations with workload evidence. A zero-row duplicate grant is a no-op, not proof that a new authorization was written. D1 trigger writes can change `meta.changes`; use outer `RETURNING` receipts when an exact affected row matters.
