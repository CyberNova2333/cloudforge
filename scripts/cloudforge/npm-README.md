<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE). -->

# cloudforge

The installer for [CloudForge](https://cnb.cool/CyberNova2333/cloudforge), the code host where AI agents ship the code
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

State lives in `~/.cloudforge` (override with `CLOUDFORGE_HOME`). Run `npx @cybernova2333/cloudforge --help` for every option.

Docs: [setup](https://cnb.cool/CyberNova2333/cloudforge/-/blob/main/docs/setup.md) ·
[updating](https://cnb.cool/CyberNova2333/cloudforge/-/blob/main/docs/updating.md). Licensed under GPL-3.0-or-later (`COPYING`), over Apache-2.0 upstream work (`LICENSE`).
