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

| Script                                              | What it does                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`                                          | Vite dev server running the Worker in `env.dev`, under a memory watchdog (below)                                                                                                                                                                                    |
| `yarn seed:demo`                                    | Fills a running local instance with demo data (see below)                                                                                                                                                                                                           |
| `yarn test`                                         | Node tests for the installer and scripts, then Vitest inside workerd with real local D1 and an in-memory Artifacts fake (`TEST_WORKERS`, default half the cores, at most 8)                                                                                         |
| `yarn test:workers [files/flags]`                   | Worker/pure frontend tests only, through the same runtime-diagnostic exit-status guard used by `yarn test`; accepts Vitest file filters and `--shard=1/2`                                                                                                           |
| `yarn typecheck`                                    | Type-checks the SPA, Worker, and installer                                                                                                                                                                                                                          |
| `yarn format` / `yarn format:check`                 | Prettier                                                                                                                                                                                                                                                            |
| `yarn db:generate`                                  | Generate a migration after changing the Drizzle schema (never hand-write migrations)                                                                                                                                                                                |
| `yarn auth:update`                                  | Regenerate `worker/src/db/auth.schema.ts` after changing the better-auth config                                                                                                                                                                                     |
| `yarn cf-typegen`                                   | Regenerate `worker/worker-configuration.d.ts` from `wrangler.jsonc.ci`                                                                                                                                                                                              |
| `yarn notices` / `yarn notices:check`               | Regenerate `THIRD_PARTY_NOTICES.md` from the installed tree and the last `yarn build`, or fail when they disagree (CI runs the check after building)                                                                                                                |
| `yarn agents:sync`                                  | Generate the `CLAUDE.md` entry point importing the canonical `AGENTS.md`, and `.agents/skills/` copies from `.claude/skills/`; never overwrite `AGENTS.md`                                                                                                          |
| `yarn cloudforge access-preflight --name <name>`    | Read-only legacy-access snapshot and compatibility diagnostics; no migration or role publication. Manual deployments require `--database` plus `--account`; see [updating](updating.md#legacy-access-preflight).                                                    |
| `yarn cloudforge access-drain-status --name <name>` | Read-only bounded unfinished D1 records; exit 0 means a valid observation even when work exists. It never certifies draining or pauses admission. Manual deployments require `--database` plus `--account`; see [drain observation](updating.md#drain-observation). |
| `yarn --cwd docs-site docs:dev`                     | VitePress dev server for the living guide on `http://127.0.0.1:5173`                                                                                                                                                                                                |
| `yarn --cwd docs-site docs:build`                   | Production static HTML build of the documentation site to `docs-site/.vitepress/dist/`                                                                                                                                                                              |
| `yarn --cwd docs-site docs:preview`                 | Local HTTP preview of the built documentation site                                                                                                                                                                                                                  |

## OIDC linking and sign-in checks

OIDC uses its own protocol, D1 actions and explicit identity bindings. Linking never creates a session; the separate native sign-in plugin grants an SDK session only after final D1 authorization and required local MFA. It does not register a Better Auth social provider. Keep `OIDC_PROVIDER` empty unless deliberately configuring it; `loginEnabled` defaults false and needs higher-version administrator publication. Keep `OIDC_CLIENT_SECRET` in secrets rather than JSON vars. See [configuration](configuration.md#oidc-identity-linking) and [the flows](oidc.md).

```bash
yarn test:workers worker/src/__tests__/oidc/oidc-linking.test.ts worker/src/__tests__/oidc/oidc-provider.test.ts worker/src/__tests__/oidc/oidc-sign-in.test.ts worker/src/__tests__/oidc/oidc-session-source.test.ts worker/src/__tests__/auth/session-secret-cache.test.ts
yarn test:workers src/lib/auth/oidcApi.test.ts src/lib/auth/oidcSignInApi.test.ts src/lib/auth/signInLock.test.ts
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
yarn vitest run --config scripts/cloudforge/vitest.config.ts scripts/agents/__tests__ scripts/githooks/__tests__
yarn agents:sync --check
```

## Layout

The Worker groups code by the feature it serves. Start in the owning domain, then follow its HTTP adapter to the service and database declarations. For example, repository creation enters `repositories/http/repos-router.ts` and calls `repositories/create.ts`. Existing modules can still contain both services and middleware; the directory layout does not imply that every dependency has been separated.

```text
DESIGN.md                   Design system specification
src/                        React SPA, with pages/components/libraries grouped by feature
e2e/                        Playwright visual and accessibility checks
docs-site/                  Independent VitePress site
repo-docs/                  Chinese source guide consumed by docs-site
worker/src/
  index.ts                  Worker assembly, URL dispatch and binding class exports
  cron.ts, variables.ts     Scheduled dispatch and request context types
  repositories/             Repository identity, permissions, branches and reports
  git/, lfs/                Git and LFS services; protocol handlers in http/handler.ts
  pulls/, merge/, stack/    PR lifecycle, landing and dependency graph
  review/, agents/, learn/, agent-runs/  Reviewer and learning workflows
  actions/, usage/, ai/     CI execution, metering and Workers AI integration
  auth/, oidc/, access/     Credentials, external identity and runtime/write admission
  members/, instance/      Profiles/namespaces and instance settings/setup
  issues/, releases/       Issue and release services
  notifications/, webhooks/, audit/  Messaging, event delivery and audit reads
  search/, live/, mcp/      Search, live updates and MCP transport
  <domain>/http/            The domain's Hono/OpenAPI routes or protocol adapter
  http/                     Shared OpenAPI schemas/helpers and request log redaction
  shared/                   Generic SQL-set, text-match and Markdown-text helpers
  db/                       Drizzle schemas and managed trigger/backfill declarations
  __tests__/<area>/         Worker tests grouped by feature; shared helpers/ alongside
migrations/                 Generated D1 migrations and metadata
scripts/
  development/, seed-demo/  Local server tools and demo fixture generation
  testing/, githooks/       Test runner/reporting and Git hook checks
  database/, cloudflare/   Schema/auth generation and binding type generation
  agents/, licensing/, i18n/, release/  Repository maintenance and release tooling
  cloudforge/              Installer CLI and package entrypoints
    commands/, planning/   Command orchestration and deterministic plans
    installation/          Installation state, configuration and ownership
    platform/              Cloudflare, process, DNS and credential adapters
    recovery/, access/     Offline recovery and access compatibility preflight
    distribution/, ui/     Package/source handling and interactive input
    __tests__/<area>/      Installer tests grouped by responsibility
```

`worker/src/index.ts` remains the Wrangler entrypoint and exports the same Durable Object and Workflow classes. Runtime URLs, bindings and database declarations are independent of these directory names. Keep HTTP registration order and authentication checks when moving adapters. The shared layer holds utilities without application-entity dependencies; business read models such as member display identity, coding sessions and repository health stay with their domains.

Run project commands from the repository root through Yarn. [package.json](../package.json) maps stable commands such as `yarn dev`, `yarn db:generate`, `yarn cf-typegen`, `yarn agents:sync`, and `yarn test:workers` to their grouped scripts. `yarn cloudforge` and `yarn pack:npm` still enter `scripts/cloudforge/cli.ts` and `scripts/cloudforge/pack.mjs`. New Node tests belong under the owning tool's `__tests__/`; the Node test configuration includes `scripts/**/*.test.ts`. Worker tests remain under `worker/src/__tests__/` and use the existing recursive Vitest include. Update explicit CI file lists when adding or moving tests.

API docs are served at `/api/swagger-ui` while running, to signed-in members (better-auth's at `/api/auth/reference`). Use the [code map](../repo-docs/code-map.md) to locate feature entrypoints and checks; a listed check is not a recorded passing result.

## Documentation site

The Chinese living guide in `repo-docs/` is rendered as an independent static site inside `docs-site/` using VitePress. Its dependencies (`vitepress`, `vue`) are completely decoupled in `docs-site/package.json` and do not touch the root lockfile or Worker runtime dependencies.

```bash
yarn --cwd docs-site install --frozen-lockfile
yarn --cwd docs-site docs:dev --host 127.0.0.1
yarn --cwd docs-site docs:build
yarn --cwd docs-site docs:preview
```

- **Single source of truth**: Documentation content is authored exclusively in `repo-docs/`. Pages in `docs-site/` import Markdown directly via VitePress include syntax (such as `&lt;!--@include: ../repo-docs/README.md--&gt;`).
- **Safe source path mapping**: `docs-site/.vitepress/guide-links.mts` rewrites links outside the documentation root into exact source paths, preventing local file leaks or broken links in production.
- **Offline & self-hosted**: IBM Plex Sans and JetBrains Mono fonts are bundled in `docs-site/.vitepress/theme/fonts/` with zero third-party CDN or Google Fonts calls.
- **Theme toggle & progressive motion**: Custom Shadow DOM element in `toggle.ts` matches Primer light/dark tokens; motion engine in `motion.ts` uses Anime.js and honors `prefers-reduced-motion` and no-JS fallback.
- **Isolated build verification**: Append `-- --outDir <external-directory>` to build outside the repository to verify zero repository pollution. Builds verify documentation presentation only, not application health or deployment.

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
- `cho` gets the password in `SEED_TEAMMATE_PASSWORD`, or the local demo default at the top of `scripts/seed-demo/seed-demo.mjs`.
  Nothing else is printed or stored: the admin's password is only used to sign in (and is not passed to wrangler), and the
  git token it creates is deleted right after the last push (or on Ctrl-C). Only what the run itself creates is backdated;
  a teammate, agents or tokens that were already there keep their dates.
- The agents do not really run: their reviews and findings are written directly, as they would have been. Containers are
  off locally, so the demo's test runs are written the same way.

## CI

Authentication schema generation uses the project-local `auth@1.7.7` through `yarn auth:update`.
The CLI and its dependencies are recorded in `yarn.lock` and included in `yarn audit`; generation does not download a separate tool tree. The retired `@better-auth/cli@1.4.21` is no longer used.
The generation-only profile in `scripts/database/auth-schema-config.ts` preserves seven existing nullable OAuth columns and the existing absence of a client-credentials JSON default. It does not change runtime plugin validation or export an HTTP handler. Unexpected upstream changes to these exact fields stop generation. The newer client/resource compound uniqueness and relation definitions are retained; the index is generated separately without rebuilding OAuth tables. Tightening populated columns needs a separate data and D1 foreign-key migration design.
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

Worker tests run through `scripts/testing/test-workers.mjs`. The installed workerd/Vitest integration can emit an
uncaught RPC teardown exception after a passing summary and still exit zero. The wrapper streams the raw output
and makes those confirmed runtime diagnostics fail the command; it never converts a nonzero exit into success.
Use `yarn test` or `yarn test:workers`, including for file filters and shards. A single worker can reduce file-boundary
teardown races but does not eliminate them. Preserve failing logs and fix or drain unfinished background work;
increasing a timeout or accepting the summary alone is not a passing verification.

On GitHub, both `CI` and `Format` run on every branch push and on pull requests. `CI` always runs every module there; neither workflow deploys.

For the first push to an empty remote named `github`, both pre-push guards use `refs/remotes/upstream/main` as the fork boundary and inspect only commits introduced by the fork. Fetch that ref before pushing. This preserves upstream commit objects and signatures instead of applying current fork rules to original upstream history. Other remotes, and GitHub branches that already exist, still use the destination tip to calculate the push delta; the mirror exception does not apply to them.

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) builds and typechecks once (`build`), then runs the tests in one job per module (`test-stacking`; `test-review`, which also covers merging and agent runs; `test-actions`, which also covers the git endpoint and LFS; `test-core`, which also covers MCP and the client-side libraries), in parallel, from the build's cache. Modules are few and balanced by runtime, because each job pays to restore the build and start vitest. On CloudForge, `build` and the test jobs run on `cloudforge-standard-4` (`runs-on` is an expression that picks `ubuntu-latest` on GitHub). GitHub's actions are pinned to commit SHAs (their version in a comment), and the runner image's base to digests; Dependabot on GitHub proposes new ones. On CloudForge a `gate` job asks [`cloudforge/relevance@v1`](ci-relevance.md) which modules a change can affect and skips the rest; on GitHub the gate is skipped and every module runs.

Every test file belongs to exactly one module. When you add a test file, add it to the `yarn test` line of its module's job; `worker/src/__tests__/platform/ci-workflow.test.ts`, which `build` always runs, fails until you do. A new module needs a `test-<name>` job, a line in the gate's `modules`, and a `run-<name>` gate output. Tests get 30 s each when `CI` is set (CloudForge Actions and GitHub all set it) or more than one worker runs, 60 s when both, 5 s on a single local worker; on CI only failing tests print their console output. Tests are offline: `worker/test/setup.ts` refuses a fetch to any host but this machine at once (a real attempt can hang on a CI runner's TLS handshake and fail after its file, while the worker shuts down); a test that needs a response stubs `fetch` itself. A test also ends only when the work it handed to `ctx.waitUntil` ends: `worker/test/setup.ts` drains it after each test (up to 5 s), so it can neither write into the next test's emptied tables nor run into its worker's shutdown. That margin is about ten times a laptop's speed, so seed fixtures in bulk (one `db.batch`, as `releases.test.ts` does with `landedMany`): a loop of a hundred separate D1 writes takes minutes on CI and times the test out.

## Dev server memory watchdog

`yarn dev` runs Vite through [`scripts/development/dev.mjs`](../scripts/development/dev.mjs), which adds up the memory of the whole dev
process tree (Node, workerd, esbuild) every 5 seconds. It logs each time usage passes another gigabyte and stops
the server, with a breakdown by process, once it passes **5 GB**, so a leak can't take the machine down. The
server uses about 1.3 GB right after starting. Change the limit with `DEV_MEMORY_LIMIT_MB=8192 yarn dev`, or turn
the watchdog off with `DEV_MEMORY_LIMIT_MB=0`. A stop for memory exits with code 137.

## Access-schema maintenance checks

After a declaration change, `yarn db:generate` owns both managed triggers and append-only one-time data declarations. Existing migration files are never edited. Keep `_triggers.json` and `_data.json`; changing, removing or reordering a recorded backfill is refused. A second generation with unchanged declarations must leave every migration/metadata hash unchanged. Logic-only auth changes still run `yarn auth:update`; compare the generated auth schema rather than inferring no schema change.

The Worker tests keep the access singleton while deleting ordinary fixture subjects through production triggers. Its generation is not reset. Separate local-only D1 bindings hold pre-migration anomaly fixtures and populated upgrade/failure cases; the normal application DB always retains the new guards. Legacy `access-preflight` fixtures stop at migration 0062 and explicitly test refusal of the compatible schema. No test disables production triggers to manufacture a passing result.

Namespace guards include source-table `lower(...)` checks as a safety backstop. Their low-frequency writes may scan members; a 129-row fixture proves bounded parameters and consistency, not constant-time throughput. Add expression indexes only through reviewed declarations with workload evidence. A zero-row duplicate grant is a no-op, not proof that a new authorization was written. D1 trigger writes can change `meta.changes`; use outer `RETURNING` receipts when an exact affected row matters.

## Actions compatibility checks

Remote action directories encode the complete ref as one path segment, so refs containing a slash cannot alias
underscore refs. Download, main and Post use the same directory calculation. Existing completed step results and
their saved commands are retained; this does not rewrite historical executions.

Cache restore checks the current ref before the default ref. Within each ref it tries the primary key, then each
ordered restore key; each candidate tries exact matching before its newest matching prefix. Only an exact primary
key match reports a cache hit. Artifact names cannot be the complete path segments `.` or `..`; ordinary dotted
names remain supported. Existing objects with ambiguous historical ownership are not automatically moved or deleted.

Step-time expressions can use `hashFiles()` against the current checked-out workspace. For example, a step may
set `key: deps-${{ hashFiles('**/yarn.lock') }}` in a cache action after checkout. An unmatched pattern returns an
empty string. Matching supports exclusions and dotfiles; file reads stay inside the workspace. Results use sorted
paths, so a multi-file digest need not be byte-for-byte identical to GitHub's directory-listing order. Calls are
unavailable during job planning. Keep the limits and replay behavior in the [Actions architecture](architecture.md#actions)
when changing the implementation.

Explicit step names resolve again with the runtime context, while generated `Run <first line>` names keep the
workflow's original text. Both ordinary `run` commands and actions receive `GITHUB_EVENT_PATH`; `github.event`
contains the supported push or pull-request snapshot. Old runs retain unknown fields, and payload size limits can
shorten optional metadata. Do not infer support for every GitHub webhook field or action from these additions.

```sh
yarn test:workers worker/src/__tests__/actions/actions-github-compat.test.ts worker/src/__tests__/actions/actions-event-payload.test.ts worker/src/__tests__/actions/actions-syntax.test.ts
yarn vitest run --config scripts/cloudforge/vitest.config.ts scripts/actions/__tests__/hash-files.test.ts
```

The second command uses the actual container program through Node. Its POSIX filesystem cases run on Linux;
Windows reports those cases as skipped. CI's `test-actions` owns the two new Worker suites; the Node configuration
discovers `scripts/actions/` through its existing `scripts/**/*.test.ts` include.

## Process and runner dependency boundaries

Source-mode installer commands use the same shell-free Yarn/Corepack resolver as Git hooks. On Windows, a standard
`.cmd` shim is parsed into its Node.js entry instead of being executed by a shell. Arguments and stdin stay separate;
an existing but invalid Yarn installation fails explicitly instead of falling back to another package manager.

The runner's dependencies are independent of the application lockfile. Its Dockerfile pins the Node 24 and Go
builder digests, verifies the Git LFS source archive and module locks, runs the upstream Go tests, and copies only
the custom binary and license records into the runtime image. Global npm uses tested, pinned dependencies for all
consumers, including nested packages. Python uses hash-verified official wheels with their original dependency
metadata and licenses. Build inputs and provenance live in `actions/runner/`. Advance `DEBIAN_SECURITY_REFRESH`
in the Dockerfile when checking distribution updates so cached deploy builds rerun the APT upgrade layer.
Expat is temporarily rebuilt from pinned official sources with Debian packaging on the runtime distribution;
its package metadata, licenses and test records remain in the image. See `actions/runner/expat/README.md` for
the build contract and the condition for returning to the distribution package.

Build the final image with `docker build --platform linux/amd64 -t cloudforge-runner-test actions/runner`.
Run its offline functional checks by mounting `actions/runner/smoke.cjs` at `/smoke.cjs` read-only, with
`--network none --read-only --tmpfs /tmp:exec --entrypoint node`, and pass `/smoke.cjs` as the command. The executable
temporary mount lets the checks run their locally compiled fixture; all writes remain under `/tmp`. The checks cover
the actual npm dependency resolution, package installation, Python wheel builds, basic compilers, and local Git LFS
transfers. The installed Git LFS license manifest is checked too. Cloudflare currently requires
[Linux AMD64 container images](https://developers.cloudflare.com/containers/concepts/architecture/).

Scan the final image after all package installation steps; application `yarn audit` and a base-image scan do not
cover the final runner. Keep upstream package metadata and remaining distribution findings visible. These local
checks do not establish production deployment or cloud-container end-to-end results.

An Actions command refused before execution returns a serializable runtime-admission result. It is persisted as a
preparation failure, without restarting the job or running subsequent always/post commands. Unknown RPC/container
interruptions retain their existing restart behavior. Cache eviction deletes at most 1000 R2 keys per call; a failed
batch is retried from the remaining object listing.
