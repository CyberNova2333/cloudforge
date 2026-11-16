# Access Model, Auth Isolation & Security Boundaries

## 1. Repository Visibility & Permissions

Repositories belong either to a **personal namespace** (`/<username>/<repo>`, `private` by default, switchable to `internal` or `public`) or the instance's **shared team namespace** (`/<team-slug>/<repo>`, `internal` by default, explicitly switchable to `public` by admins, never `private`). Usernames and team slugs share one case-insensitive normalized namespace claim table.

| Role                               | Read Scope                               | Push & Write                                                | Repo Settings / Admin |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------- | --------------------- |
| Site Admin (`admin`)               | All repositories                         | Allowed                                                     | Allowed               |
| Personal Owner / Team Repo Creator | Owned / created repos                    | Allowed                                                     | Allowed               |
| Direct Collaborator                | Assigned repos                           | Allowed                                                     | **Denied**            |
| Other Active Members               | All team, `internal`, and `public` repos | **Denied**                                                  | **Denied**            |
| Anonymous / Banned                 | `public` repos only                      | **Denied**                                                  | **Denied**            |
| Reviewer Agent Account             | Own config repo + invited review context | Own learning branch only (`AGENT.md` body / `knowledge/**`) | **Denied**            |

- **Non-disclosure 404**: Unreadable private repositories consistently return `404` across UI, REST, Search, Notifications, Git HTTP, and LFS.
- **Access compatibility layer**: Stages A & B added internal `can(perms, capability)` mapping plus `compat-v1` / `runtime-bridge-v1` schema guards, while multi-team memberships and 5-tier roles (`read`/`triage`/`write`/`maintain`/`admin`) remain gated off (`rolePublishingAllowed: false`; see `docs/team-access-design.md`).
- **Profile email privacy**: Account emails are visible only to site admins and the account owner; other members receive `null` (`git` commit author emails are preserved as Git data).

## 2. Credential Isolation Matrix

- **Browser Sessions**: D1 `sessions` HMAC cookie (`__Secure-` over HTTPS `BASE_URL`); same-origin POST guard.
- **Personal Access Tokens (PAT)**: Accepted for Git HTTP, Git LFS, and commit status routes (`/statuses/{sha}`, `/commits/{ref}/status`) only; scoped by `min(member_perms, token_scope)`.
- **Repository Deploy Tokens (`cfd_`)**: Scoped to one immutable `repository_id` for Git HTTP & LFS only; cannot log into Web, REST, or `/mcp`; capped at 50 tokens/repo and 1–366 days TTL; re-checks creator admin status on every request.
- **OAuth 2.1 JWTs (`/mcp`)**: Accepted exclusively on `POST /mcp` (`aud = <origin>/mcp`, 1h TTL); disconnection immediately revokes consents and stops future calls.

## 3. High-Risk Guards & Limits

- **Recent Local Proof & Generation CAS**: Changing team settings, collaborators, instance settings, sensitive repo settings, mandatory MFA policies, or OIDC provider configs requires recent local password + enrolled 2FA verification and generation-checked conditional SQL writes (`409` on conflict; see `docs/authentication.md` & `docs/oidc.md`).
- **OIDC Linking & SSO**: Admins explicitly enable the provider and `loginEnabled`; existing members link under recent local proof; SSO callbacks pause at an explicit confirmation + local MFA step before issuing an `sso`-sourced session.
- **Body & SSRF Caps**: Request bodies are capped at `64 KB` (`/api/auth/*`) and `1 MB` (`/api/*`, `/mcp`); outbound Webhooks reject `localhost`, `.local`, `.internal`, and private/reserved IP literals.
