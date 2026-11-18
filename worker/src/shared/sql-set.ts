// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Bind a string set as one JSON parameter, below D1's 100-parameter statement limit. */
export function inJsonArray(
  column: AnySQLiteColumn | SQL,
  values: string[]
): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}
