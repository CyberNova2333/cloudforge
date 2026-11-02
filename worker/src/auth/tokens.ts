// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { sha256Hex, toHex } from '../git/bytes';

export function randomToken(prefix: string, bytes = 20): string {
  return prefix + toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export const hashToken = sha256Hex;
