// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
export function resolvePnpmCommand(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): { command: string; args: string[] };
export const resolvePnpmLifecycleCommand: typeof resolvePnpmCommand;
