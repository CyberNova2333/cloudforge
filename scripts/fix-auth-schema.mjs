#!/usr/bin/env node
// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Post-processes the generated auth.schema.ts: better-auth CLI 1.7 emits an untypeable
 * `.default()` for empty-array defaults (`clientCredentialsScopes`); the column has none, so
 * it is dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'worker/src/db/auth.schema.ts';
const src = readFileSync(FILE, 'utf8');
const notice =
  '// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).';
const body = src.replace(/\)\s*\.default\(\)/g, ')');
const fixed = body.startsWith(notice) ? body : `${notice}\n${body}`;
if (fixed !== src) writeFileSync(FILE, fixed);
