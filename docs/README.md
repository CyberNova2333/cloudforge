<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->

# CloudForge documentation

**Deploy and operate**

- [Setup](setup.md) — deploy your own instance by hand (or run `/cloudforge-onboarding` in Claude Code).
- [Configuration](configuration.md) — every `wrangler.jsonc` key and secret the worker reads.
- [Architecture](architecture.md) — how the Worker, D1, and Artifacts fit together.
- [身份认证与账户恢复](authentication.md) — TOTP、恢复码、独立离线因子恢复及后续 SSO / 强制 MFA 的安全边界。
- [Local development](development.md) — run, test, and change CloudForge locally.
- [Reviewer agents and auto-merge](auto-merge.md) — who reviews each pull request commit, when a pull request lands, its states, and stacking.
- [Skipping irrelevant tests](ci-relevance.md) — `cloudforge/relevance@v1`: Clef decides which test jobs a change can affect.
