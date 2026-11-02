#!/usr/bin/env node
// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * Adds the canonical fork notice to generated auth.schema.ts. Retain cleanup for
 * the invalid empty `.default()` emitted by the retired CLI; current generation
 * preserves deployed column defaults through scripts/database/auth-schema-config.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'worker/src/db/auth.schema.ts';
const src = readFileSync(FILE, 'utf8');
const notice =
  '// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).';
const body = src.replace(/\)\s*\.default\(\)/g, ')');
const fixed = body.startsWith(notice) ? body : `${notice}\n${body}`;
if (fixed !== src) writeFileSync(FILE, fixed);
