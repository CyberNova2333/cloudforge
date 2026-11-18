// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Modifications by CyberNova are licensed under AGPL-3.0-only with Additional Terms (see LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
/** "octocat via Claude Mod" for a decision a moderator app made over MCP; just the person for the web UI. */
export function withVia(name: string, via: string | null | undefined) {
  return via ? `${name} via ${via}` : name;
}
