// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// Substring matches for search boxes. instr, not LIKE: D1 refuses LIKE and GLOB patterns over 50 bytes, which a
// search word reaches easily (and sooner once accents and escapes are counted). lower() ignores ASCII case, as LIKE
// does, and the text needs no escaping.

type Column = AnySQLiteColumn | SQL;

/** `column` contains `text`, ignoring ASCII case. */
export const contains = (column: Column, text: string): SQL =>
  sql`instr(lower(${column}), lower(${text})) > 0`;

/** `column` starts with `text`, ignoring ASCII case. */
export const startsWith = (column: Column, text: string): SQL =>
  sql`instr(lower(${column}), lower(${text})) = 1`;
