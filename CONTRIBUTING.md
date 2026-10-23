<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE). -->

# Contributing to CloudForge

Thanks for your interest in contributing.

## Licensing of contributions

This project is distributed under the **GNU GPL v3 or later** (`COPYING`), on top of the
Apache-2.0 licensed upstream work (`LICENSE`). There is no CLA.

By opening a pull request you agree that your contribution is licensed under GPL-3.0-or-later,
and that you have the right to license it. Please sign off every commit (`git commit -s`):

    Signed-off-by: Your Name <you@example.com>

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
