// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: AGPL-3.0-only.
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
import { readAccessRuntime } from '../runtime';

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
