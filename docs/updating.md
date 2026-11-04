<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Updating

CloudForge ships as an npm package, `@cybernova2333/cloudforge`, that carries a built release and deploys it to your Cloudflare account with its own pinned wrangler. Installing and upgrading need Node.js 22 or later and Docker, running: deploying builds the Actions runner image.

Docker is checked first, before anything is planned or written. Without it you get one of two messages: `Docker is not installed.` (install Docker Desktop, start it, run the same command again) or `Docker is installed but not running.` (start it, run the same command again). `adopt` and `status` never check Docker.

## Install

```bash
npx @cybernova2333/cloudforge install
```

See [Setup](setup.md) for the questions, the flags, and what it creates. State lives in `~/.cloudforge/<name>/` (override the directory with `CLOUDFORGE_HOME`).

## Access compatibility schema

The generated compatibility migration adds four defaulted columns to the existing team/collaborator tables and creates access state plus namespace claims. It does not rebuild old tables, move repository ids, change public/internal visibility or enable new role grants. The database continues to accept only one `instance` shared team and `write` collaborators; explicit teams and other roles are rejected until the later rollout is implemented.

Bootstrap preserves the existing shared-team id and owner/creator references, and refuses ambiguous teams, namespace collisions, team-private rows or broken references. Do not repair these by deleting a conflicting identity or silently changing visibility. The singleton generation is permanent and monotonic; one-time data declarations are tracked by id/hash in generated `_data.json`. Keep this metadata and migration receipts: later DDL/trigger regeneration must not reinitialize state. A completed migration is retried by its receipt, not by replaying bootstrap SQL. Before either deployment and before the final success marker, every migration in the target source must have its actual database receipt. A locally completed migration step never overrides a missing cloud receipt; a resumed upgrade stops for investigation instead of silently deploying.

`access-preflight` distinguishes `legacy`, `compat-v1` and `runtime-bridge-v1`; partial or unsupported schemas are refused. The bridge adds a permanent `access_runtime_state` singleton with minimum protocol 1, `compat-v1` mode, disabled role publication and a revision. The final read-only snapshot checks its complete table definition, managed trigger bodies and bounded row, alongside installation ownership. A higher minimum protocol blocks this release. Its exit 0 and digest never authorize this migration or role publication. This bridge supplies admission checks only for code that implements the runtime protocol. It does not retrofit pre-bridge Workers, prove global traffic convergence or fence every human mutation. The old first-admin setup implementation assumes D1 `meta.changes === 1`; new trigger writes invalidate that assumption, so first-admin initialization must use the new `RETURNING` receipt implementation. Do not treat the additive schema as blanket support for arbitrary older Workers.

Local tests cover populated old data, failed migration rollback and receipt-aware retries using real D1 binding transactions. Remote migration failure injection, production migration, deployment and real rollout require separate authorization and verification. See the [current compatibility boundaries](permissions.md) and [the staged design](team-access-design.md).

The authentication generator update also declares a unique `(client_id, resource_id)` index for OAuth resource links. Its separate generated migration does not rebuild OAuth tables or tighten historical nullable columns. Duplicate old links block that index migration; inspect them and explicitly resolve the duplicate before retrying. Do not automatically delete links or tokens. Migration receipts are per file: the access migration can already be complete when the later index file fails, so retry by the recorded state rather than assuming every prior file rolled back. The access preflight does not check these OAuth duplicates.

## Legacy access preflight

Before changing the legacy team/collaborator model, inspect one explicitly selected installation. From a checkout:

```bash
yarn cloudforge access-preflight --name cloudforge
# For a manual deployment, select both the account and database:
yarn cloudforge access-preflight --database <name-or-uuid> --account <id-or-name>
```

This command verifies the actual account/database and recorded installation marker, discovers the schema using a bounded read, then selects a single bounded data snapshot that rechecks schema and ownership. It does not run Docker, write local state, migrate or deploy. It accepts no apply, `--yes` or `--expect-plan` flags. Exit 0 means only that this observation has no blocking findings; 1 means blocked or unreadable data, and 2 means invalid arguments. Report version 2 identifies `schemaVersion` as `legacy`, `compat-v1` or `runtime-bridge-v1`, with `accessGeneration` for the compatible schemas and a non-secret `runtime` observation for the bridge. The JSON always reports `rolePublishingAllowed: false`, `migrationApplied: false` and `compatibility.rollbackSafe: false`.

The report checks shared-team selection, collaborator/write compatibility, creator administration, namespaces, public repositories and anomalous references. Compatible databases also require intact access state, the stable team pointer, instance/write-only data, safe revisions, matching namespace claims and the supported table definitions and managed trigger bodies. Each collection is limited to 1000 rows with an overflow sentinel; fields, schema metadata, aggregate bytes and finding samples are also bounded. Overflow, malformed results and unknown schemas fail closed. The digest identifies the observation; it is not a later apply authorization or proof that the database is still unchanged. No account emails, credentials or installation ownership nonce are printed.

A successful preflight does not implement new roles or certify that every old Worker has stopped. The installer pins runtime protocol 1, the exact bridge migration and the complete 66-file migration set. It accepts historical compatible schemas before migration, then requires the bridge schema and a supported D1 minimum protocol before deployment; it rechecks after confirmation and on resume. A diagnostic `ready: false` response does not by itself prohibit deploying a compatible repair, because the database check is authoritative. Final write authorization and global publication/rollback orchestration remain separate work. See the [current access behavior](permissions.md) and [migration design](team-access-design.md).

## Upgrade

The session-assurance update (migration `0052`) records actual primary and second-factor methods and verification times, separately
from the existing one-use factor proof. Apply its generated session/user columns and managed version triggers
before deploying. Existing sessions without evidence remain explicitly unknown; enrollment and sliding refresh
do not invent verification. Password/factor changes and offline recovery advance the authentication generation;
stale browser sessions are rejected by the API and native auth readers. Existing MCP authorizations and machine
credentials keep their prior rules. This update does not enable an enforced MFA policy.

The optional two-factor update adds migration `0050` (`two_factors`, the user's enabled flag and a short-lived
session proof). Apply pending migrations before deploying. No new Cloudflare binding or secret is needed.
Account settings now offer TOTP with single-use recovery codes; password sign-in waits for the second factor.
Enabling or disabling it revokes other browser sessions. OAuth refresh tokens retain their existing authorization
with their session link cleared. Previously issued MCP JWTs still require a current consent and expire normally;
disconnect an app to revoke it immediately. Personal and repository deploy tokens retain their existing rules.
Password resets preserve the factor and recovery codes, while invalidating unfinished challenges based on the
old password. Self-service password changes now revoke other browser sessions even when the caller omits
`revokeOtherSessions`, while retaining the current session. Save recovery codes before relying on TOTP, especially for an administrator account.
See [身份认证与账户恢复](authentication.md) for first-version limits and the separate plans for enforced MFA and SSO.

The repository deploy-token update adds migration `0049` (`repository_deploy_tokens`); apply pending migrations
before deploying this version. No new binding or secret is required, and existing personal tokens are unchanged.
Repository settings now offer scoped HTTPS Git/LFS credentials, read-only by default and expiring after 1–366 days.
They cannot call REST/MCP or push protected/default branches. Initialize the repository's default branch as an admin
first; the token issuer must remain an active repository admin. Revoking a token blocks new requests, while existing
Git transfers and already signed LFS URLs can finish. See [部署令牌设计与使用](deploy-tokens.md), including the Actions
secret implications of writable tokens.

Personal access token creation now enforces the existing 50-active-token limit atomically under concurrent requests.
Expired tokens still do not consume the quota; existing tokens, scopes and expiry values are not changed or revoked.

Default-branch updates now require an existing branch under `refs/heads/`, rather than accepting a tag or arbitrary
commit SHA. An existing branch whose name happens to be 40 hexadecimal characters remains valid: default-branch
content, search, agent configuration, review/learning, relevance and omitted-ref MCP status reads resolve its branch
tip explicitly. PR base/head and landing-target reads and learning retries also resolve branches explicitly, so a
SHA-shaped branch name cannot cause an empty review or incorrectly skip path-filtered CI. Explicit MCP commit-status
ref values continue to accept commit SHAs; the contents browser resolves the configured default name as a branch.

```bash
npx @cybernova2333/cloudforge@latest upgrade
```

If `npx` offers an older version right after a release, its registry cache is stale: add `--prefer-online` (`npx --prefer-online @cybernova2333/cloudforge@latest upgrade`).

`upgrade` moves an installation to the package's version. It reads the running version from the worker's `/.well-known/cloudforge`, prints a plan (migrations to apply, resources and secrets to add, the deploy), and asks before applying.

- `--name <name>` picks the installation when several are recorded.
- `--plan` only shows the plan and prints the exact apply command, ending in `--expect-plan <digest> --yes`. The apply refuses if the plan has changed since you reviewed it.
- `--resume` continues an upgrade that failed part-way after checking the current Cloudflare settings and, when reachable, the running site again. Local progress records do not authorize replacing a newer deployment.
- `--yes` applies without asking; it is required outside a terminal.
- It never downgrades. If the worker runs a newer version it stops and prints the command for that version.
- It only adds secrets the worker lacks and never touches `SETUP_CODE_HASH`. The R2 upload keys and the analytics token are asked for in a terminal (leave one empty to skip it); with `--yes` the deploy goes ahead without them and lists them as missing, with the command that adds them later.
- If the worker runs code that is not a release (a fork, local changes), it stops before changing anything. `--replace-custom-code` replaces it with stock CloudForge. Forks keep deploying from their own checkout.
- A worker deployed from a checkout reports its commit instead of a version. The package lists every commit its release contains (`history.txt`, written by `pack.mjs`), so a commit in that list is an upgrade and the release's own commit is the same version, checked offline; any other commit (a newer build, or commits that are not in a release) stops as custom code.

### Resuming a failed upgrade safely

The upgrade plan now includes an access compatibility check. The source checkout and release package carry `access-protocol.json`, declaring the supported schemas, the fingerprint of access migration `0065_silent_albert_cleary.sql`, and a digest of the complete migration set. That digest covers the sorted filenames and normalized content hashes of all 67 SQL files, including release creation receipts in `0066_minor_ultragirl.sql`. The CLI also pins these fingerprints; adding, removing or altering any migration, even with a changed adjacent JSON, stops before migration. Only CRLF-to-LF checkout conversion is normalized. A later release that changes migrations must review and update this contract with its supported-schema checks. Missing or inconsistent descriptors, unsupported database structure, invalid compatibility data and migration-receipt disagreements stop the upgrade. `--yes` and `--replace-custom-code` do not bypass these checks.

The access check runs again after confirmation and optional credential prompts, before migration, and before deployment. Deployment requires the target compatible schema to be observed. The read-only diagnostic stays separate from applying an upgrade; neither its digest nor an unchanged ACL generation authorizes a later write. Databases above the bounded snapshot limit need a separately reviewed maintenance path; the installer does not silently sample them and proceed.

This declaration describes the CLI's supported contract and the shipped migration. It does not attest arbitrary modified Worker code or lock other machines out of D1. A compatible observation can become stale between Cloudflare requests. Global role publication, active old versions, version URLs and rollback safety remain separate work; no new role grants are enabled by a successful upgrade check.

Empty-database upgrade recovery records its reviewed source state immediately before migration, bound to the current target and the installer's recorded created database. If migration succeeds but deployment fails, that record permits retry while the marker has not yet been written; the actual schema is still checked. The record is cleared on completion. An existing wrong marker always stops recovery, and a successful marker receipt ends the missing-marker exception, including for first-time adoption. Local recovery records do not substitute for cloud ownership checks.

The final D1 marker write checks ownership in the write statement itself: it initializes an empty marker table or updates the sole row with the same installation ID and nonce. A changed owner or multiple rows are preserved and cause a failure. A missing response is reported as unconfirmed, so retry begins with a fresh ownership read. This protects D1 ownership; it does not make all Worker, R2 and database operations one transaction.

A normal resume requires readable Cloudflare Worker settings containing the same installation ID and ownership nonce and a reported version. A newer release is rejected even when its migration filenames are unchanged. An unexpected intermediate release or a disagreement between the site and settings also stops before changes; custom code replacement requires `--replace-custom-code` on the current invocation. If the main deploy already has a successful receipt, a later change away from its target blocks resume even with that flag: an old completed step cannot authorize a new replacement. Review the current deployment instead of retrying an old resume command blindly.

If the site version probe is unavailable, recovery can continue using verified Worker settings for the recorded source or intended target version. Missing settings, ownership evidence or version stops recovery; local `deployedVersion` is not substituted for that evidence. Existing checks for retained configuration and the first upgrade after adoption also apply during resume. A successful deploy whose local receipt was lost may still be recovered when the settings and reachable site both identify the intended target.

There is one limited exception for an instance adopted without writing cloud markers: before the first successful main-deploy receipt, an online resume may recheck the original bindings, resource IDs, URL, namespace IDs and source version using the read-only adoption checks. It retains the original configuration inputs and does not invent an ownership nonce. If that unmarked site is unavailable, restore site access before retrying resume. Malformed or mismatching markers do not qualify for the exception.

If the second deploy filled Durable Object namespace variables but its local receipt was lost, resume may explain those values only with the namespaces currently belonging to this Worker. It still rejects changes to already-recorded namespace identities or unrelated remote values; it does not disable the remaining configuration checks.

These are read-only observations before the upgrade proceeds, not an atomic lock against another machine deploying later or proof that every gradual-deployment traffic version has converged. Non-retained tunable defaults keep the existing comparison policy; this change does not add a complete snapshot of all dashboard variables. New ACL role publication and old-Worker rollback barriers remain separate work.

A deploy restarts any running Actions jobs (each restarts from the beginning, up to 3 attempts), so deploying when no CI is running avoids that.

The audit hardening update adds migrations `0036` through `0039` for recoverable landings, PR close follow-ups, stored Actions event
context, and a PR state revision that rejects stale close/reopen requests. Apply them before deploying the Worker. As a conservative upgrade procedure, finish or cancel existing
Actions runs first: this update does not retroactively encrypt old durable results, and the new decoder cannot
read their plaintext format. Existing-instance version handling across deployment has not been verified for
this update. Start a fresh run if one cannot resume.
The MCP tools are named `cloudforge_*` (they were `gitorange_*`). `tools/list` shows only the new names, but a call by
an old name still reaches the same tool with the same permission checks, so connected agents keep working; update
prompts, skills and tool allowlists to the new names when convenient.

The security update adds migrations `0040` through `0044` and changes behaviour; check each point after upgrading:

- **Instance-wide Actions secrets reach only the repositories chosen for them** (Site admin → Actions secrets and
  variables → Repositories). Existing ones reach none after the upgrade: choose their repositories, or jobs read them
  as empty. Instance-wide variables still reach every repository.
- **Pushes to the default branch and protected branches are restricted**: only repository admins push to them, and
  only fast-forwards; nobody deletes or force-pushes them, and nobody pushes `refs/pull/*`. Collaborators who pushed to
  the default branch directly now open a pull request instead.
  Protected pushes upload objects through temporary internal refs, validate ancestry, then compare-and-swap the
  requested refs. A rejected force push never temporarily moves the protected branch. Protected requests using
  `push-options` are rejected; ordinary unprotected pushes keep their existing protocol path.
- **Authors don't approve their own pull requests** (nor approve or dismiss findings on them, through the web, MCP
  moderator apps or Let Claude decide). On an instance with one maintainer, turn on Site admin → Settings → Reviews →
  "Authors approve their own pull requests". Closing, reopening and the version bump of a pull request need push
  access, and auto-merge waits while the author can't push to the repository.
- **Self sign-up confirms addresses or stays closed**: a sign-up email domain list now also requires confirming the
  address by email, and while "Verify email on sign-up" is on or a domain list is set, an instance without outbound
  email refuses sign-ups (the sign-in page shows sign-up as closed). Accounts that signed up unconfirmed while email
  was missing can't sign in until they confirm: set up Email Sending (they request a new link from the sign-in
  page), or turn off verification and clear the domain list.
- **Pages carry a Content-Security-Policy** (`public/_headers`), and Markdown in READMEs, pull requests and comments
  no longer renders `<style>`, `style` attributes, forms and their controls (a task list's checkbox stays, read-only)
  or classes other than code blocks' `language-*`. Scripts added to pages at the zone (Cloudflare Web Analytics'
  automatic setup, Zaraz, a Transform Rule) are blocked unless their source is added to `script-src`.
- **Setting up a new instance needs a setup code** unless it is served and configured on a local-only name: without
  `SETUP_CODE_HASH`, the welcome page refuses to create the first admin (see [Setup](setup.md#6-set-the-secrets)).
  Instances that already have an admin are unaffected.
- **A workflow run holds at most 128 jobs** (matrices expanded); a workflow with more is invalid. Site admin → Settings
  → Actions → Largest runner (default `standard-4`, as before) caps the size `runs-on` may ask for.
- **Personal access tokens can be read-only** (Settings → Personal access tokens → Access); existing tokens keep read
  and write. A member holds at most 50 unexpired tokens.
- **Site admin → Settings → Jobs running at once per repository** (empty by default: only the instance's limit) keeps
  one repository from holding every Actions slot. Normal queue grants and the queue-outage fallback reserve capacity
  atomically in D1 before booting, enforcing both limits even when only some jobs can reach the queue.
  Recovery includes reservations without queue entries and retains capacity if Workflow/container shutdown cannot
  be confirmed. Failed container destruction preserves the runner's hard-stop alarm. HTTP cancellation and terminal
  Workflow reconciliation now share this confirmed-stop boundary with queue recovery. Repository deletion returns
  retryable HTTP 409 until its bounded stop passes complete; it keeps D1 capacity and checks for new runs again in
  the final deletion batch. A zero-row deletion does not publish a storage-cleanup outbox.
- **Guarded reviewer agents review every pull request**: Clef no longer decides whether a guarded agent (`guarded:
true`, or the security or data facet) is requested, so such agents review changes they used to skip.

The issues update adds migration `0045` (issues, their comments, labels, assignees and timeline, the pull requests that
name them, and `repositories.has_issues`, on by default). Apply it before deploying the Worker. Then:

- **Every repository has an Issues tab** (an admin turns it off in Settings → General, keeping its issues). Issues are
  numbered with pull requests, so a repository's next pull request skips the numbers its issues took. See
  [Issues](issues.md).
- **`Fixes #12` in a pull request's title or description closes issue #12** when the pull request lands on the default
  branch. Pull requests opened before the upgrade link their issues the next time their title or description is edited.

The notifications update adds migration `0046` (notifications, thread subscriptions and repository watches). Apply it
before deploying the Worker. Then:

- **Members get notifications** about issues and pull requests they opened, took part in, were mentioned in or assigned
  to, and every thread of repositories they watch (the bell in the top band, `/notifications`). See
  [Notifications](notifications.md).
- **Those that concern them directly are also emailed** when the instance sends email and their address is verified;
  each member chooses participating (the default), all or off in Settings → Notifications.
  Pending email rechecks current repository access, ban status, verification and notification choices before sending.
- **`notifications` is a reserved name**: an account or team already named `notifications` keeps working, but its
  profile page is now hidden behind the inbox; rename it if you have one.

The webhooks update adds migration `0047` (commit statuses, webhooks and their deliveries) and a third Cron Trigger,
`*/5 * * * *`, that retries webhook deliveries and sends notification emails left unsent. Apply the migration before
deploying the Worker, and add the trigger to your own `wrangler.jsonc` (`triggers.crons`, as in `wrangler.jsonc.example`);
deploying registers it. Then:

- **External CI can report commit statuses** (`POST /api/repos/{owner}/{repo}/statuses/{sha}`) with a personal access
  token in `Authorization: Bearer …`; only the three status endpoints accept a token, the rest of the API still needs a
  session. A failing or pending status blocks merging like an Actions run. See [Webhooks](webhooks.md).
- **Repository admins can add webhooks** in Settings → Webhooks or through the API (`/api/repos/{owner}/{repo}/hooks`).
  The page includes secret replacement/removal, delivery records, test pings and redelivery. Webhook secrets are
  encrypted with the same key as Actions secrets; decryption failure stops delivery instead of sending unsigned data.
- **Checks display external CI results** alongside Actions. MCP clients can report and read statuses with
  `cloudforge_create_commit_status` and `cloudforge_get_commit_status` under the same repository permissions.

The audited integration adds migration `0048`, an index on Actions job status and run ID for capacity admission and
recovery. Apply `0040`–`0048` in order before deploying. The first-admin write now
checks the setup claim in the same D1 batch as its credential, preventing an expired setup request from creating a
second administrator. Secret repository allowlist replacement is atomic. Closed-PR internal-ref cleanup resumes with
a persistent repository cursor, including after an outage longer than a week.

Changing `ACTIONS_SECRETS_KEY` (including setting it for the first time after using the fallback) or the fallback
`BETTER_AUTH_SECRET` invalidates in-flight encrypted Actions state and makes stored webhook secrets unreadable (set them again); rerun those workflows after the change.

## Adopt an existing installation

`adopt` takes over an installation that was made some other way, so `upgrade` can manage it. It changes nothing on Cloudflare.

Checkout adoption refuses a destination that already contains a configuration or installation state, including
a dangling configuration symlink. Preserve or relocate that existing content before retrying. New files are
published without replacing existing entries; interrupted adoption checks ownership and unchanged contents before rolling back its files
and never recursively deletes the destination. Files retained after an interruption require inspection before retrying.
Other writers must honor the installation lock: filesystem comparison and removal are not one atomic operation.
Failure to remove a private `.adopt-*.tmp` link retains it for inspection without undoing a successful publication
or replacing the original operation error.

From a checkout that ran `yarn cloudforge install`, which moves its record under `~/.cloudforge`:

```bash
npx @cybernova2333/cloudforge adopt --from path/to/checkout
```

(`--name <name>` picks one when the checkout holds several.) Or a worker deployed by hand, read from Cloudflare:

```bash
npx @cybernova2333/cloudforge adopt --worker <worker name> --account <id|name>
```

`--plan` shows what would be recorded; apply with `--expect-plan <digest> --yes`. APP_NAME, AI_GATEWAY and the model variables are kept as found.

## Status

```bash
npx @cybernova2333/cloudforge status
```

Shows a recorded installation and asks the deployed worker whether it matches. `--from <checkout>` reads one that is still in a checkout.

## Reset a password

```bash
npx @cybernova2333/cloudforge reset-password <username or email>
```

For when nobody can sign in to make a reset link (the only site admin forgot their password, or the instance cannot
send email): sets a new password straight in the installation's D1 database over the Cloudflare API, signs out every
session of that member, and records it in the audit log. It asks for the password twice in the terminal, so it never
appears in your shell history. `--name <name>` picks a recorded installation; for one made without this CLI, pass
`--database <D1 database name>` (and `--account <id|name>` when the login sees several accounts). Agents have no
password and are refused.

## Recover a lost second factor

`reset-password` keeps TOTP enabled. If the authenticator and every recovery code were lost, use the separate
`reset-mfa` command with Cloudflare D1 write access. First review the exact account, database, member and effects:

```bash
npx @cybernova2333/cloudforge reset-mfa octocat --name cloudforge --reason "Lost authenticator and all recovery codes" --plan
```

Then repeat without `--plan` for a confirmation that defaults to no. For a manually deployed installation pass both
`--account <id|name>` and `--database <name|uuid>` instead of `--name`. Non-interactive execution requires
`--yes --expect-plan <digest>` from the reviewed preview. Apply the recovery migration before using this command;
missing or altered triggers are refused. In a checkout use `yarn cloudforge` instead of the package command.

Recovery removes the factor, recovery codes, browser sessions and second-factor challenges, and records the reason.
It preserves the password, bans, roles, PATs, deploy tokens and existing MCP authorizations. Reasons appear in the audit
log: never include secrets. A lost response is checked by its recovery event ID without repeating the write. See the
[authentication design](authentication.md#独立离线因子恢复) for concurrency, permissions and recovery boundaries.

## Forks and checkouts

If you run a fork or prefer a clone, the original flow works: `git pull && yarn install && yarn db:migrate:prod && yarn deploy` from your checkout, or `yarn cloudforge install|status` there. Run the migrations before the deploy: new code may read new tables.

## Publishing a release (maintainers)

Releases come from the CloudForge instance that hosts the repository, and are published to npm from your own machine. npm asks for a one-time code, so this is never automated.

1. Cut a release in CloudForge (the Releases tab, or `cloudforge_create_release`) from `main`. The Releases tab cuts from the default branch; `release:publish` refuses a tag that is not on `main`.
2. From a clone with `origin` and `main` up to date, run:

   ```bash
   yarn release:publish vX.Y.Z
   ```

   It checks with git, not the GitHub REST API, that the tag is on `origin` and on `main`, and that the version is not already on npm. It then builds that exact commit in a fresh worktree, runs the tests, packs the package, and checks the packed package as CI's Package job does: a dry-run deploy of the config an install would generate, and `cloudforge --help` from the installed tarball. Any failure stops it before anything is asked. It then shows what it is about to publish and asks you to confirm. `npm publish` of that tarball follows, and npm asks for your 2FA code.

3. Upgrade the instance that runs this repository from the published package:

   ```bash
   npx --prefer-online @cybernova2333/cloudforge@X.Y.Z upgrade --name cloudforge
   ```

Cut, publish and upgrade only when a person says so.

### 成员删除与运行清理的后续加固（2026-10-31）

生成迁移 `0062_auth_triggers.sql` 增加用户删除的最终数据库防线：拥有个人仓库或作为团队仓库创建者的成员必须先通过正常仓库删除流程处理资源。原生管理接口对该情况拒绝删除，不预先清掉其密码账户或会话；无仓库成员的成功删除原子级联并记录不含邮箱的审计事件。迁移和 Worker 部署需要分别授权、按实例实际已应用记录操作，本地测试不表示生产已应用。

执行器重启及最终清理也以容器 destroy 成功作为记录停止和释放容量的前提。停止失败只重试相应持久清理步骤，保留占用及恢复追踪；不会为重新清理而重放已经完成的用户命令。用户看到 run 逻辑结束不代表所有容器已经停止，容量可能继续保留到停止确认。
