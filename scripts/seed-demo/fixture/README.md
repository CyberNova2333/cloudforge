# Invoices

A small invoicing service for a one-person consultancy. It keeps invoices in a
database, works out totals, and serves a short JSON API.

## Endpoints

| Method | Path        | What it does                    |
| ------ | ----------- | ------------------------------- |
| GET    | `/invoices` | Lists invoices with their total |
| POST   | `/invoices` | Creates an invoice              |

## Running it

```sh
pnpm install
pnpm dev
```

Run the tests with `pnpm test`. They also run on every push to `main`.
The initial demo has no lockfile; commit the generated `pnpm-lock.yaml` before switching its workflow to frozen installs.

## Money

Amounts are stored as whole cents. Every invoice so far is in Canadian dollars.
