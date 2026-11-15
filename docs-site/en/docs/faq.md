# Troubleshooting FAQ

## Why does the installer say `"The API token cannot read: ..."`?

Your `CLOUDFLARE_API_TOKEN` or Wrangler login lacks one of the Account-level scopes required in `docs/setup.md` (Workers Scripts, R2, D1, Containers, Artifacts, AI). Add the missing permission and re-run `install` or `upgrade`.

## Why do all routes return `503 Service Unavailable` (`Cache-Control: no-store`)?

Starting with `runtime-bridge-v1`, HTTP, Git/LFS, and background workers check `access_runtime_state` in D1 before authentication. If migrations are incomplete, the singleton row is missing, or a deployed Worker runs an older protocol than required by D1, requests fail closed with 503 while `GET/HEAD /.well-known/cloudforge` remains accessible for non-secret diagnostics. Note that Cloudflare Durable Objects can defer code updates for up to 300s by default.

## How do I recover a locked-out admin or lost MFA device?

Enabling mandatory MFA locks accounts without enrolled factors into `/settings/security` (`enroll_mfa`) until TOTP + one-time recovery codes are saved. For lost credentials or hardware devices, run the offline recovery commands with explicit target confirmation:

- `pnpm dlx @cybernova2333/cloudforge reset-password`
- `pnpm dlx @cybernova2333/cloudforge reset-mfa` (clears personal factors and rotates tokens/sessions without weakening the instance MFA policy).

## Why is a push or deploy token (`cfd_`) rejected?

- Writable deploy tokens require an existing default branch initialized by an admin first—they cannot push an initial branch to an empty repository.
- Default and protected branches reject non-admin pushes, force pushes, and deletions; `refs/pull/*` rejects all external pushes.
- Private repositories intentionally return `404` instead of `403` to prevent existence disclosure.

## Why did an `engine: pi` review fall back to single-pass or stop at 2 hours?

- If `AGENT_REVIEWER` Durable Object bindings are omitted, `engine: pi` gracefully runs as a single pass.
- Deep checkouts exclude binaries, symlinks, lockfiles, and `.orangeignore` matches (capped at 3,000 files / 24 MB / 512 KB per file, summarized in `/review/not-checked-out.txt`). Adjust `review.pi_minutes` (5–60) or tool/token limits in Site admin; stalled rows past 2 hours are closed by daily cleanup so you can trigger Retry.
