<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# cloudforge

The installer for [CloudForge](https://github.com/CyberNova2333/cloudforge), the code host where AI agents ship the code
and people approve the risk, on Cloudflare Workers. This package carries a built CloudForge release (worker, web app,
database migrations and the Actions runner image's Dockerfile) and deploys it to your Cloudflare account with its own
pinned wrangler. You do not need a clone of the repository.

Requires Node.js 22 or later, and Docker running for `install` and `upgrade`: deploying builds the Actions runner
image.

## Install

```bash
npx @cybernova2333/cloudforge install
```

It asks for what it needs, shows the plan, and applies it when you confirm. Sign in first with
`npx wrangler login`, or set `CLOUDFLARE_API_TOKEN`. To review the plan without changing anything:

```bash
npx @cybernova2333/cloudforge install --plan
```

## Upgrade

```bash
npx @cybernova2333/cloudforge@latest upgrade
```

Moves an installation to the package's version: applies new migrations, adds new resources and secrets, and
deploys. It never downgrades.

## Adopt an existing installation

From a checkout that ran `yarn cloudforge install`:

```bash
npx @cybernova2333/cloudforge adopt --from path/to/checkout
```

Or a worker deployed by hand:

```bash
npx @cybernova2333/cloudforge adopt --worker <worker name>
```

## Status

```bash
npx @cybernova2333/cloudforge status
```

## Reset a password

```bash
npx @cybernova2333/cloudforge reset-password <username or email>
```

Sets a new password straight in the database, for when nobody can sign in to make a reset link. Asks for it in the
terminal; `--database <D1 database name>` for an installation made without this CLI.

State lives in `~/.cloudforge` (override with `CLOUDFORGE_HOME`). Run `npx @cybernova2333/cloudforge --help` for every option.

If the authenticator and every recovery code were lost, use the independent recovery command with Cloudflare
management access and an explicitly selected installation:

```bash
npx @cybernova2333/cloudforge reset-mfa octocat --name cloudforge --reason "Lost authenticator and recovery codes" --plan
```

Review the preview, then repeat without `--plan` to confirm. Manual deployments require both `--account` and
`--database`; automation also requires `--yes --expect-plan <digest>`. The recovery migration must be installed.
This clears the factor, browser sessions and challenges, records the reason, and preserves the password and
machine credentials. Never include secrets in the reason. `reset-password` continues to preserve the second factor.

Docs: [setup](https://github.com/CyberNova2333/cloudforge/blob/main/docs/setup.md) ·
[updating](https://github.com/CyberNova2333/cloudforge/blob/main/docs/updating.md). Licensed under GPL-3.0-or-later (`LICENSE`), over Apache-2.0 upstream work (`LICENSES/Apache-2.0.txt`).
