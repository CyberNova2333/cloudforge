# Auth, OIDC, Access Compatibility & MCP Gateway

CloudForge applies distinct isolation guarantees across human browsers, machine credentials, Reviewer Agents, and `/mcp` OAuth clients.

- **Direct Session & Policy Gates**: Standard requests read D1 `sessions` with constant-time cookie HMAC validation (`worker/src/auth/session.ts`). Mandatory MFA policies (`worker/src/auth/policy.ts`) quarantine un-enrolled members to security setup, while sensitive writes demand recent local password + 2FA proof (`worker/src/auth/recent.ts`) plus conditional generation checks (`409` on race).
- **Explicit OIDC & Kill Switch**: Administrators publish provider configs (`enabled` & `loginEnabled`), existing members bind under recent local proof, and SSO callbacks require interactive confirmation and local MFA before minting `sso`-tagged sessions (`worker/src/oidc/service.ts`).
- **Access Runtime Protocol & `/mcp`**: Every Worker entrypoint invokes `worker/src/access/runtime.ts` against `access_runtime_state` (`503` fail-closed on mismatch; `rolePublishingAllowed` remains `false`). `POST /mcp` (`worker/src/mcp/index.ts`) verifies JWT audience/user/consent locally (`worker/src/mcp/oauth-session.ts`) and hides the 3 moderator tools unless `mcp_moderators` is explicitly enabled with per-consent prompting.

Next: [Code Map & Contributing](/en/docs/code-map) or [Stage 4: Migrations & ADRs](/en/docs/changelog-and-migrations).
