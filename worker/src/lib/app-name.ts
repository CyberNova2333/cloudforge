// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
export const DEFAULT_APP_NAME = 'CloudForge';

/** App name as an MCP server id: "XY Space Git" → "xy-space-git". */
export function mcpServerName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cloudforge'
  );
}
