// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
import { readAccessRuntime } from './access-runtime';

/** Gate before authentication, body parsing, or Git/LFS traffic reaches Artifacts. */
export async function accessRuntimeResponse(DB: D1Database) {
  if ((await readAccessRuntime(DB)).ready) return null;
  return new Response('Service temporarily unavailable.\n', {
    status: 503,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

/** Only the metadata probe may explain why this executing runtime is unavailable. */
export function isAccessRuntimeProbe(request: Request) {
  return (
    (request.method === 'GET' || request.method === 'HEAD') &&
    new URL(request.url).pathname === '/.well-known/cloudforge'
  );
}
