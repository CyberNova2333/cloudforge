<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# Updating

CloudForge ships as an npm package, `@cybernova2333/cloudforge`, that carries a built release and deploys it to your Cloudflare account with its own pinned wrangler. Installing and upgrading need Node.js 22 or later and Docker, running: deploying builds the Actions runner image.

Docker is checked first, before anything is planned or written. Without it you get one of two messages: `Docker is not installed.` (install Docker Desktop, start it, run the same command again) or `Docker is installed but not running.` (start it, run the same command again). `adopt` and `status` never check Docker.

## Install

```bash
npx @cybernova2333/cloudforge install
```

See [Setup](setup.md) for the questions, the flags, and what it creates. State lives in `~/.cloudforge/<name>/` (override the directory with `CLOUDFORGE_HOME`).

## Upgrade

```bash
npx @cybernova2333/cloudforge@latest upgrade
```

If `npx` offers an older version right after a release, its registry cache is stale: add `--prefer-online` (`npx --prefer-online @cybernova2333/cloudforge@latest upgrade`).

`upgrade` moves an installation to the package's version. It reads the running version from the worker's `/.well-known/cloudforge`, prints a plan (migrations to apply, resources and secrets to add, the deploy), and asks before applying.

- `--name <name>` picks the installation when several are recorded.
- `--plan` only shows the plan and prints the exact apply command, ending in `--expect-plan <digest> --yes`. The apply refuses if the plan has changed since you reviewed it.
- `--resume` continues an upgrade that failed part-way.
- `--yes` applies without asking; it is required outside a terminal.
- It never downgrades. If the worker runs a newer version it stops and prints the command for that version.
- It only adds secrets the worker lacks and never touches `SETUP_CODE_HASH`. The R2 upload keys and the analytics token are asked for in a terminal (leave one empty to skip it); with `--yes` the deploy goes ahead without them and lists them as missing, with the command that adds them later.
- If the worker runs code that is not a release (a fork, local changes), it stops before changing anything. `--replace-custom-code` replaces it with stock CloudForge. Forks keep deploying from their own checkout.
- A worker deployed from a checkout reports its commit instead of a version. The package lists every commit its release contains (`history.txt`, written by `pack.mjs`), so a commit in that list is an upgrade and the release's own commit is the same version, checked offline; any other commit (a newer build, or commits that are not in a release) stops as custom code.

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
  be confirmed. Failed container destruction preserves the runner's hard-stop alarm.
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
