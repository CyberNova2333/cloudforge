import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Bind a string set as one JSON parameter, below D1's 100-parameter statement limit. */
export function inJsonArray(
  column: AnySQLiteColumn | SQL,
  values: string[]
): SQL {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}
