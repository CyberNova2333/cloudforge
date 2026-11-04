// CloudForge release tag creation evidence; metadata only, never Git objects.
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { repositories } from './app.schema';

// Written only after the absent-only Git create returned success. An existing tag without this receipt is never
// inferred to be an interrupted release from its head or from the absence of matching Actions runs.
export const releaseTagReceipts = sqliteTable(
  'release_tag_receipts',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    commitSha: text('commit_sha').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.tag] })]
);
