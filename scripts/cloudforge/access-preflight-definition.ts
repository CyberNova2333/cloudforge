// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
// Frozen ACL definitions produced by applying the reviewed migrations through 0062 / 0064.
// Exact DDL preserves defaults, PK/FK/CHECK rules, index collations and partial predicates.
// This is a supported-schema contract, not a migration generator or permission to apply SQL.
import { ACCESS_TRIGGERS } from '../../worker/src/db/access-triggers.ts';
import { ACCESS_RUNTIME_TRIGGERS } from '../../worker/src/db/access-runtime-triggers.ts';
export const ACCESS_PREFLIGHT_LEGACY_DEFINITION = {
  users: {
    sql: "CREATE TABLE `users` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`email` text NOT NULL,\n\t`email_verified` integer DEFAULT false NOT NULL,\n\t`image` text,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`role` text,\n\t`banned` integer DEFAULT false,\n\t`ban_reason` text,\n\t`ban_expires` integer,\n\t`username` text,\n\t`display_username` text\n, `two_factor_enabled` integer DEFAULT false, `auth_version` integer DEFAULT 0 NOT NULL)",
    columns: [
      [0, 'id', 'TEXT', 1, null, 1, 0],
      [1, 'name', 'TEXT', 1, null, 0, 0],
      [2, 'email', 'TEXT', 1, null, 0, 0],
      [3, 'email_verified', 'INTEGER', 1, 'false', 0, 0],
      [4, 'image', 'TEXT', 0, null, 0, 0],
      [
        5,
        'created_at',
        'INTEGER',
        1,
        "cast(unixepoch('subsecond') * 1000 as integer)",
        0,
        0,
      ],
      [
        6,
        'updated_at',
        'INTEGER',
        1,
        "cast(unixepoch('subsecond') * 1000 as integer)",
        0,
        0,
      ],
      [7, 'role', 'TEXT', 0, null, 0, 0],
      [8, 'banned', 'INTEGER', 0, 'false', 0, 0],
      [9, 'ban_reason', 'TEXT', 0, null, 0, 0],
      [10, 'ban_expires', 'INTEGER', 0, null, 0, 0],
      [11, 'username', 'TEXT', 0, null, 0, 0],
      [12, 'display_username', 'TEXT', 0, null, 0, 0],
      [13, 'two_factor_enabled', 'INTEGER', 0, 'false', 0, 0],
      [14, 'auth_version', 'INTEGER', 1, '0', 0, 0],
    ],
    indexes: [
      {
        name: 'sqlite_autoindex_users_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'users_email_lower_idx',
        sql: 'CREATE INDEX `users_email_lower_idx` ON `users` (lower(`email`))',
        unique: 0,
        origin: 'c',
        partial: 0,
        columns: [
          [0, -2, null, 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'users_email_unique',
        sql: 'CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 2, 'email', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'users_username_unique',
        sql: 'CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 11, 'username', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [],
  },
  teams: {
    sql: 'CREATE TABLE `teams` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`slug` text NOT NULL,\n\t`name` text NOT NULL,\n\t`created_at` integer NOT NULL\n)',
    columns: [
      [0, 'id', 'TEXT', 1, null, 1, 0],
      [1, 'slug', 'TEXT', 1, null, 0, 0],
      [2, 'name', 'TEXT', 1, null, 0, 0],
      [3, 'created_at', 'INTEGER', 1, null, 0, 0],
    ],
    indexes: [
      {
        name: 'sqlite_autoindex_teams_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'teams_slug_unique',
        sql: 'CREATE UNIQUE INDEX `teams_slug_unique` ON `teams` (`slug`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 1, 'slug', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [],
  },
  repositories: {
    sql: "CREATE TABLE `repositories` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`description` text,\n\t`default_branch` text DEFAULT 'main' NOT NULL,\n\t`artifacts_name` text NOT NULL,\n\t`next_pr_number` integer DEFAULT 1 NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL, `team_id` text REFERENCES teams(id), `visibility` text DEFAULT 'internal' NOT NULL, `protected_branches` text, `merging_paused_at` integer, `merging_paused_by_id` text, `delete_merged_branches` integer DEFAULT true NOT NULL, `language` text, `language_sha` text, `has_issues` integer DEFAULT true NOT NULL,\n\tFOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade\n)",
    columns: [
      [0, 'id', 'TEXT', 1, null, 1, 0],
      [1, 'owner_id', 'TEXT', 1, null, 0, 0],
      [2, 'name', 'TEXT', 1, null, 0, 0],
      [3, 'description', 'TEXT', 0, null, 0, 0],
      [4, 'default_branch', 'TEXT', 1, "'main'", 0, 0],
      [5, 'artifacts_name', 'TEXT', 1, null, 0, 0],
      [6, 'next_pr_number', 'INTEGER', 1, '1', 0, 0],
      [7, 'created_at', 'INTEGER', 1, null, 0, 0],
      [8, 'updated_at', 'INTEGER', 1, null, 0, 0],
      [9, 'team_id', 'TEXT', 0, null, 0, 0],
      [10, 'visibility', 'TEXT', 1, "'internal'", 0, 0],
      [11, 'protected_branches', 'TEXT', 0, null, 0, 0],
      [12, 'merging_paused_at', 'INTEGER', 0, null, 0, 0],
      [13, 'merging_paused_by_id', 'TEXT', 0, null, 0, 0],
      [14, 'delete_merged_branches', 'INTEGER', 1, 'true', 0, 0],
      [15, 'language', 'TEXT', 0, null, 0, 0],
      [16, 'language_sha', 'TEXT', 0, null, 0, 0],
      [17, 'has_issues', 'INTEGER', 1, 'true', 0, 0],
    ],
    indexes: [
      {
        name: 'repositories_artifacts_name_unique',
        sql: 'CREATE UNIQUE INDEX `repositories_artifacts_name_unique` ON `repositories` (`artifacts_name`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 5, 'artifacts_name', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'repositories_personal_name_uq',
        sql: 'CREATE UNIQUE INDEX `repositories_personal_name_uq` ON `repositories` (`owner_id`,`name`) WHERE team_id IS NULL',
        unique: 1,
        origin: 'c',
        partial: 1,
        columns: [
          [0, 1, 'owner_id', 0, 'BINARY', 1],
          [1, 2, 'name', 0, 'BINARY', 1],
          [2, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'repositories_team_name_uq',
        sql: 'CREATE UNIQUE INDEX `repositories_team_name_uq` ON `repositories` (`team_id`,`name`) WHERE team_id IS NOT NULL',
        unique: 1,
        origin: 'c',
        partial: 1,
        columns: [
          [0, 9, 'team_id', 0, 'BINARY', 1],
          [1, 2, 'name', 0, 'BINARY', 1],
          [2, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'repositories_updated_idx',
        sql: 'CREATE INDEX `repositories_updated_idx` ON `repositories` (`updated_at`)',
        unique: 0,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 8, 'updated_at', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'sqlite_autoindex_repositories_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [
      [0, 0, 'users', 'owner_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
      [1, 0, 'teams', 'team_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
    ],
  },
  repository_collaborators: {
    sql: 'CREATE TABLE `repository_collaborators` (\n\t`repository_id` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\tPRIMARY KEY(`repository_id`, `user_id`),\n\tFOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade\n)',
    columns: [
      [0, 'repository_id', 'TEXT', 1, null, 1, 0],
      [1, 'user_id', 'TEXT', 1, null, 2, 0],
      [2, 'created_at', 'INTEGER', 1, null, 0, 0],
    ],
    indexes: [
      {
        name: 'repository_collaborators_user_idx',
        sql: 'CREATE INDEX `repository_collaborators_user_idx` ON `repository_collaborators` (`user_id`)',
        unique: 0,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 1, 'user_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'sqlite_autoindex_repository_collaborators_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'repository_id', 0, 'BINARY', 1],
          [1, 1, 'user_id', 0, 'BINARY', 1],
          [2, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [
      [0, 0, 'users', 'user_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
      [
        1,
        0,
        'repositories',
        'repository_id',
        'id',
        'NO ACTION',
        'CASCADE',
        'NONE',
      ],
    ],
  },
  agents: {
    sql: "CREATE TABLE `agents` (\n\t`user_id` text PRIMARY KEY NOT NULL,\n\t`repository_id` text,\n\t`name` text NOT NULL,\n\t`bio` text DEFAULT '' NOT NULL,\n\t`trigger_ask` text NOT NULL,\n\t`trigger_above` real NOT NULL,\n\t`engine` text DEFAULT 'pass' NOT NULL,\n\t`config_sha` text,\n\t`config_error` text,\n\t`created_by_id` text,\n\t`created_at` integer NOT NULL,\n\t`deleted_at` integer, `color` text, `facet` text, `guarded` integer DEFAULT false NOT NULL, `review_language` text,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null\n)",
    columns: [
      [0, 'user_id', 'TEXT', 1, null, 1, 0],
      [1, 'repository_id', 'TEXT', 0, null, 0, 0],
      [2, 'name', 'TEXT', 1, null, 0, 0],
      [3, 'bio', 'TEXT', 1, "''", 0, 0],
      [4, 'trigger_ask', 'TEXT', 1, null, 0, 0],
      [5, 'trigger_above', 'REAL', 1, null, 0, 0],
      [6, 'engine', 'TEXT', 1, "'pass'", 0, 0],
      [7, 'config_sha', 'TEXT', 0, null, 0, 0],
      [8, 'config_error', 'TEXT', 0, null, 0, 0],
      [9, 'created_by_id', 'TEXT', 0, null, 0, 0],
      [10, 'created_at', 'INTEGER', 1, null, 0, 0],
      [11, 'deleted_at', 'INTEGER', 0, null, 0, 0],
      [12, 'color', 'TEXT', 0, null, 0, 0],
      [13, 'facet', 'TEXT', 0, null, 0, 0],
      [14, 'guarded', 'INTEGER', 1, 'false', 0, 0],
      [15, 'review_language', 'TEXT', 0, null, 0, 0],
    ],
    indexes: [
      {
        name: 'agents_repository_uq',
        sql: 'CREATE UNIQUE INDEX `agents_repository_uq` ON `agents` (`repository_id`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 1, 'repository_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'sqlite_autoindex_agents_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'user_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [
      [0, 0, 'users', 'created_by_id', 'id', 'NO ACTION', 'SET NULL', 'NONE'],
      [
        1,
        0,
        'repositories',
        'repository_id',
        'id',
        'NO ACTION',
        'SET NULL',
        'NONE',
      ],
      [2, 0, 'users', 'user_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
    ],
  },
  install_state: {
    sql: 'CREATE TABLE `install_state` (\n\t`installation_id` text PRIMARY KEY NOT NULL,\n\t`ownership_nonce` text NOT NULL,\n\t`version` text,\n\t`manifest_json` text,\n\t`updated_at` integer NOT NULL\n)',
    columns: [
      [0, 'installation_id', 'TEXT', 1, null, 1, 0],
      [1, 'ownership_nonce', 'TEXT', 1, null, 0, 0],
      [2, 'version', 'TEXT', 0, null, 0, 0],
      [3, 'manifest_json', 'TEXT', 0, null, 0, 0],
      [4, 'updated_at', 'INTEGER', 1, null, 0, 0],
    ],
    indexes: [
      {
        name: 'sqlite_autoindex_install_state_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'installation_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [],
  },
} as const;

export const ACCESS_PREFLIGHT_COMPAT_DEFINITION = {
  users: {
    sql: "CREATE TABLE `users` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`email` text NOT NULL,\n\t`email_verified` integer DEFAULT false NOT NULL,\n\t`image` text,\n\t`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,\n\t`role` text,\n\t`banned` integer DEFAULT false,\n\t`ban_reason` text,\n\t`ban_expires` integer,\n\t`username` text,\n\t`display_username` text\n, `two_factor_enabled` integer DEFAULT false, `auth_version` integer DEFAULT 0 NOT NULL)",
    columns: [
      [0, 'id', 'TEXT', 1, null, 1, 0],
      [1, 'name', 'TEXT', 1, null, 0, 0],
      [2, 'email', 'TEXT', 1, null, 0, 0],
      [3, 'email_verified', 'INTEGER', 1, 'false', 0, 0],
      [4, 'image', 'TEXT', 0, null, 0, 0],
      [
        5,
        'created_at',
        'INTEGER',
        1,
        "cast(unixepoch('subsecond') * 1000 as integer)",
        0,
        0,
      ],
      [
        6,
        'updated_at',
        'INTEGER',
        1,
        "cast(unixepoch('subsecond') * 1000 as integer)",
        0,
        0,
      ],
      [7, 'role', 'TEXT', 0, null, 0, 0],
      [8, 'banned', 'INTEGER', 0, 'false', 0, 0],
      [9, 'ban_reason', 'TEXT', 0, null, 0, 0],
      [10, 'ban_expires', 'INTEGER', 0, null, 0, 0],
      [11, 'username', 'TEXT', 0, null, 0, 0],
      [12, 'display_username', 'TEXT', 0, null, 0, 0],
      [13, 'two_factor_enabled', 'INTEGER', 0, 'false', 0, 0],
      [14, 'auth_version', 'INTEGER', 1, '0', 0, 0],
    ],
    indexes: [
      {
        name: 'sqlite_autoindex_users_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'users_email_lower_idx',
        sql: 'CREATE INDEX `users_email_lower_idx` ON `users` (lower(`email`))',
        unique: 0,
        origin: 'c',
        partial: 0,
        columns: [
          [0, -2, null, 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'users_email_unique',
        sql: 'CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 2, 'email', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'users_username_unique',
        sql: 'CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 11, 'username', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [],
  },
  teams: {
    sql: "CREATE TABLE `teams` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`slug` text NOT NULL,\n\t`name` text NOT NULL,\n\t`created_at` integer NOT NULL\n, `membership_mode` text DEFAULT 'instance' NOT NULL, `revision` integer DEFAULT 0 NOT NULL)",
    columns: [
      [0, 'id', 'TEXT', 1, null, 1, 0],
      [1, 'slug', 'TEXT', 1, null, 0, 0],
      [2, 'name', 'TEXT', 1, null, 0, 0],
      [3, 'created_at', 'INTEGER', 1, null, 0, 0],
      [4, 'membership_mode', 'TEXT', 1, "'instance'", 0, 0],
      [5, 'revision', 'INTEGER', 1, '0', 0, 0],
    ],
    indexes: [
      {
        name: 'sqlite_autoindex_teams_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'teams_slug_unique',
        sql: 'CREATE UNIQUE INDEX `teams_slug_unique` ON `teams` (`slug`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 1, 'slug', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [],
  },
  repositories: {
    sql: "CREATE TABLE `repositories` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`description` text,\n\t`default_branch` text DEFAULT 'main' NOT NULL,\n\t`artifacts_name` text NOT NULL,\n\t`next_pr_number` integer DEFAULT 1 NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL, `team_id` text REFERENCES teams(id), `visibility` text DEFAULT 'internal' NOT NULL, `protected_branches` text, `merging_paused_at` integer, `merging_paused_by_id` text, `delete_merged_branches` integer DEFAULT true NOT NULL, `language` text, `language_sha` text, `has_issues` integer DEFAULT true NOT NULL,\n\tFOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade\n)",
    columns: [
      [0, 'id', 'TEXT', 1, null, 1, 0],
      [1, 'owner_id', 'TEXT', 1, null, 0, 0],
      [2, 'name', 'TEXT', 1, null, 0, 0],
      [3, 'description', 'TEXT', 0, null, 0, 0],
      [4, 'default_branch', 'TEXT', 1, "'main'", 0, 0],
      [5, 'artifacts_name', 'TEXT', 1, null, 0, 0],
      [6, 'next_pr_number', 'INTEGER', 1, '1', 0, 0],
      [7, 'created_at', 'INTEGER', 1, null, 0, 0],
      [8, 'updated_at', 'INTEGER', 1, null, 0, 0],
      [9, 'team_id', 'TEXT', 0, null, 0, 0],
      [10, 'visibility', 'TEXT', 1, "'internal'", 0, 0],
      [11, 'protected_branches', 'TEXT', 0, null, 0, 0],
      [12, 'merging_paused_at', 'INTEGER', 0, null, 0, 0],
      [13, 'merging_paused_by_id', 'TEXT', 0, null, 0, 0],
      [14, 'delete_merged_branches', 'INTEGER', 1, 'true', 0, 0],
      [15, 'language', 'TEXT', 0, null, 0, 0],
      [16, 'language_sha', 'TEXT', 0, null, 0, 0],
      [17, 'has_issues', 'INTEGER', 1, 'true', 0, 0],
    ],
    indexes: [
      {
        name: 'repositories_artifacts_name_unique',
        sql: 'CREATE UNIQUE INDEX `repositories_artifacts_name_unique` ON `repositories` (`artifacts_name`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 5, 'artifacts_name', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'repositories_personal_name_uq',
        sql: 'CREATE UNIQUE INDEX `repositories_personal_name_uq` ON `repositories` (`owner_id`,`name`) WHERE team_id IS NULL',
        unique: 1,
        origin: 'c',
        partial: 1,
        columns: [
          [0, 1, 'owner_id', 0, 'BINARY', 1],
          [1, 2, 'name', 0, 'BINARY', 1],
          [2, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'repositories_team_name_uq',
        sql: 'CREATE UNIQUE INDEX `repositories_team_name_uq` ON `repositories` (`team_id`,`name`) WHERE team_id IS NOT NULL',
        unique: 1,
        origin: 'c',
        partial: 1,
        columns: [
          [0, 9, 'team_id', 0, 'BINARY', 1],
          [1, 2, 'name', 0, 'BINARY', 1],
          [2, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'repositories_updated_idx',
        sql: 'CREATE INDEX `repositories_updated_idx` ON `repositories` (`updated_at`)',
        unique: 0,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 8, 'updated_at', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'sqlite_autoindex_repositories_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [
      [0, 0, 'users', 'owner_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
      [1, 0, 'teams', 'team_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
    ],
  },
  repository_collaborators: {
    sql: "CREATE TABLE `repository_collaborators` (\n\t`repository_id` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`created_at` integer NOT NULL, `role` text DEFAULT 'write' NOT NULL, `revision` integer DEFAULT 0 NOT NULL,\n\tPRIMARY KEY(`repository_id`, `user_id`),\n\tFOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade\n)",
    columns: [
      [0, 'repository_id', 'TEXT', 1, null, 1, 0],
      [1, 'user_id', 'TEXT', 1, null, 2, 0],
      [2, 'created_at', 'INTEGER', 1, null, 0, 0],
      [3, 'role', 'TEXT', 1, "'write'", 0, 0],
      [4, 'revision', 'INTEGER', 1, '0', 0, 0],
    ],
    indexes: [
      {
        name: 'repository_collaborators_user_idx',
        sql: 'CREATE INDEX `repository_collaborators_user_idx` ON `repository_collaborators` (`user_id`)',
        unique: 0,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 1, 'user_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'sqlite_autoindex_repository_collaborators_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'repository_id', 0, 'BINARY', 1],
          [1, 1, 'user_id', 0, 'BINARY', 1],
          [2, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [
      [0, 0, 'users', 'user_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
      [
        1,
        0,
        'repositories',
        'repository_id',
        'id',
        'NO ACTION',
        'CASCADE',
        'NONE',
      ],
    ],
  },
  agents: {
    sql: "CREATE TABLE `agents` (\n\t`user_id` text PRIMARY KEY NOT NULL,\n\t`repository_id` text,\n\t`name` text NOT NULL,\n\t`bio` text DEFAULT '' NOT NULL,\n\t`trigger_ask` text NOT NULL,\n\t`trigger_above` real NOT NULL,\n\t`engine` text DEFAULT 'pass' NOT NULL,\n\t`config_sha` text,\n\t`config_error` text,\n\t`created_by_id` text,\n\t`created_at` integer NOT NULL,\n\t`deleted_at` integer, `color` text, `facet` text, `guarded` integer DEFAULT false NOT NULL, `review_language` text,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null,\n\tFOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null\n)",
    columns: [
      [0, 'user_id', 'TEXT', 1, null, 1, 0],
      [1, 'repository_id', 'TEXT', 0, null, 0, 0],
      [2, 'name', 'TEXT', 1, null, 0, 0],
      [3, 'bio', 'TEXT', 1, "''", 0, 0],
      [4, 'trigger_ask', 'TEXT', 1, null, 0, 0],
      [5, 'trigger_above', 'REAL', 1, null, 0, 0],
      [6, 'engine', 'TEXT', 1, "'pass'", 0, 0],
      [7, 'config_sha', 'TEXT', 0, null, 0, 0],
      [8, 'config_error', 'TEXT', 0, null, 0, 0],
      [9, 'created_by_id', 'TEXT', 0, null, 0, 0],
      [10, 'created_at', 'INTEGER', 1, null, 0, 0],
      [11, 'deleted_at', 'INTEGER', 0, null, 0, 0],
      [12, 'color', 'TEXT', 0, null, 0, 0],
      [13, 'facet', 'TEXT', 0, null, 0, 0],
      [14, 'guarded', 'INTEGER', 1, 'false', 0, 0],
      [15, 'review_language', 'TEXT', 0, null, 0, 0],
    ],
    indexes: [
      {
        name: 'agents_repository_uq',
        sql: 'CREATE UNIQUE INDEX `agents_repository_uq` ON `agents` (`repository_id`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 1, 'repository_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'sqlite_autoindex_agents_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'user_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [
      [0, 0, 'users', 'created_by_id', 'id', 'NO ACTION', 'SET NULL', 'NONE'],
      [
        1,
        0,
        'repositories',
        'repository_id',
        'id',
        'NO ACTION',
        'SET NULL',
        'NONE',
      ],
      [2, 0, 'users', 'user_id', 'id', 'NO ACTION', 'CASCADE', 'NONE'],
    ],
  },
  install_state: {
    sql: 'CREATE TABLE `install_state` (\n\t`installation_id` text PRIMARY KEY NOT NULL,\n\t`ownership_nonce` text NOT NULL,\n\t`version` text,\n\t`manifest_json` text,\n\t`updated_at` integer NOT NULL\n)',
    columns: [
      [0, 'installation_id', 'TEXT', 1, null, 1, 0],
      [1, 'ownership_nonce', 'TEXT', 1, null, 0, 0],
      [2, 'version', 'TEXT', 0, null, 0, 0],
      [3, 'manifest_json', 'TEXT', 0, null, 0, 0],
      [4, 'updated_at', 'INTEGER', 1, null, 0, 0],
    ],
    indexes: [
      {
        name: 'sqlite_autoindex_install_state_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'installation_id', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [],
  },
  access_control_state: {
    sql: 'CREATE TABLE `access_control_state` (\n\t`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,\n\t`generation` integer DEFAULT 0 NOT NULL,\n\t`legacy_shared_team_id` text,\n\tCONSTRAINT "access_control_singleton" CHECK("access_control_state"."id" = 1),\n\tCONSTRAINT "access_control_generation" CHECK(typeof("access_control_state"."generation") = \'integer\' AND "access_control_state"."generation" >= 0 AND "access_control_state"."generation" <= 9007199254740991)\n)',
    columns: [
      [0, 'id', 'INTEGER', 1, '1', 1, 0],
      [1, 'generation', 'INTEGER', 1, '0', 0, 0],
      [2, 'legacy_shared_team_id', 'TEXT', 0, null, 0, 0],
    ],
    indexes: [],
    foreignKeys: [],
  },
  namespace_claims: {
    sql: 'CREATE TABLE `namespace_claims` (\n\t`slug` text PRIMARY KEY NOT NULL,\n\t`kind` text NOT NULL,\n\t`subject_id` text NOT NULL,\n\tCONSTRAINT "namespace_claims_kind" CHECK("namespace_claims"."kind" IN (\'user\', \'team\')),\n\tCONSTRAINT "namespace_claims_canonical" CHECK(length("namespace_claims"."slug") > 0 AND "namespace_claims"."slug" = lower("namespace_claims"."slug"))\n)',
    columns: [
      [0, 'slug', 'TEXT', 1, null, 1, 0],
      [1, 'kind', 'TEXT', 1, null, 0, 0],
      [2, 'subject_id', 'TEXT', 1, null, 0, 0],
    ],
    indexes: [
      {
        name: 'namespace_claims_subject_uq',
        sql: 'CREATE UNIQUE INDEX `namespace_claims_subject_uq` ON `namespace_claims` (`kind`,`subject_id`)',
        unique: 1,
        origin: 'c',
        partial: 0,
        columns: [
          [0, 1, 'kind', 0, 'BINARY', 1],
          [1, 2, 'subject_id', 0, 'BINARY', 1],
          [2, -1, null, 0, 'BINARY', 0],
        ],
      },
      {
        name: 'sqlite_autoindex_namespace_claims_1',
        sql: null,
        unique: 1,
        origin: 'pk',
        partial: 0,
        columns: [
          [0, 0, 'slug', 0, 'BINARY', 1],
          [1, -1, null, 0, 'BINARY', 0],
        ],
      },
    ],
    foreignKeys: [],
  },
} as const;

export const ACCESS_PREFLIGHT_BRIDGE_DEFINITION = {
  ...ACCESS_PREFLIGHT_COMPAT_DEFINITION,
  access_runtime_state: {
    sql: 'CREATE TABLE `access_runtime_state` (\n\t`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,\n\t`minimum_protocol` integer DEFAULT 1 NOT NULL,\n\t`schema_mode` text DEFAULT \'compat-v1\' NOT NULL,\n\t`role_publishing_enabled` integer DEFAULT false NOT NULL,\n\t`revision` integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT "access_runtime_singleton" CHECK("access_runtime_state"."id" = 1),\n\tCONSTRAINT "access_runtime_protocol" CHECK(typeof("access_runtime_state"."minimum_protocol") = \'integer\' AND "access_runtime_state"."minimum_protocol" >= 1 AND "access_runtime_state"."minimum_protocol" <= 9007199254740991),\n\tCONSTRAINT "access_runtime_mode" CHECK("access_runtime_state"."schema_mode" = \'compat-v1\'),\n\tCONSTRAINT "access_runtime_roles_closed" CHECK("access_runtime_state"."role_publishing_enabled" = 0),\n\tCONSTRAINT "access_runtime_revision" CHECK(typeof("access_runtime_state"."revision") = \'integer\' AND "access_runtime_state"."revision" >= 0 AND "access_runtime_state"."revision" <= 9007199254740991)\n)',
    columns: [
      [0, 'id', 'INTEGER', 1, '1', 1, 0],
      [1, 'minimum_protocol', 'INTEGER', 1, '1', 0, 0],
      [2, 'schema_mode', 'TEXT', 1, "'compat-v1'", 0, 0],
      [3, 'role_publishing_enabled', 'INTEGER', 1, 'false', 0, 0],
      [4, 'revision', 'INTEGER', 1, '0', 0, 0],
    ],
    foreignKeys: [],
    indexes: [],
  },
} as const;

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const bounded = (field: string, bytes = 128) =>
  `CASE WHEN ${field} IS NULL THEN NULL WHEN typeof(${field}) = 'text' AND length(CAST(${field} AS BLOB)) <= ${bytes} THEN ${field} ELSE '!unsupported' END`;
const array = (expressions: readonly string[]) =>
  `json_array(${expressions.join(', ')})`;
const aggregate = (row: string, source: string) =>
  `(SELECT json_group_array(${row}) FROM (${source}))`;

/** A static SELECT predicate. No metadata or received SQL is ever executed. */
export function accessDefinitionGuardSql(
  version: 'legacy' | 'compat-v1' | 'runtime-bridge-v1'
): string {
  const definition: Readonly<
    Record<
      string,
      {
        sql: string;
        columns: readonly (readonly unknown[])[];
        foreignKeys: readonly (readonly unknown[])[];
        indexes: readonly {
          name: string;
          sql: string | null;
          unique: number;
          origin: string;
          partial: number;
          columns: readonly (readonly unknown[])[];
        }[];
      }
    >
  > =
    version === 'legacy'
      ? ACCESS_PREFLIGHT_LEGACY_DEFINITION
      : version === 'compat-v1'
        ? ACCESS_PREFLIGHT_COMPAT_DEFINITION
        : ACCESS_PREFLIGHT_BRIDGE_DEFINITION;
  const guards: string[] = [];
  // Authentication trigger bodies are audited by that subsystem. This gate only allows their
  // two historical names here; all access trigger bodies are checked by the final snapshot.
  const allowedTriggers = [
    'cloudforge_factor_auth_version_v1',
    'cloudforge_user_repository_delete_v1',
    ...(version !== 'legacy'
      ? ACCESS_TRIGGERS.map((trigger) => trigger.name)
      : []),
    ...(version === 'runtime-bridge-v1'
      ? ACCESS_RUNTIME_TRIGGERS.map((trigger) => trigger.name)
      : []),
  ];
  guards.push(
    `NOT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'trigger' AND lower(tbl_name) IN (${Object.keys(definition).map(literal).join(', ')}) AND name NOT IN (${allowedTriggers.map(literal).join(', ')}))`
  );
  if (version === 'legacy')
    guards.push(
      "NOT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'trigger' AND substr(lower(name), 1, 18) = 'cloudforge_access_')"
    );
  if (version !== 'runtime-bridge-v1')
    guards.push(
      "NOT EXISTS (SELECT 1 FROM sqlite_schema WHERE lower(name) = 'access_runtime_state' OR (type = 'trigger' AND substr(lower(name),1,19) = 'cloudforge_runtime_'))"
    );
  for (const [table, expected] of Object.entries(definition)) {
    // Accept only the two source-file newline conventions. Replacing whitespace in stored SQL
    // would also alter quoted literals and could accidentally bless a different CHECK/default.
    const sqlForms = [
      ...new Set([expected.sql, expected.sql.replaceAll('\n', '\r\n')]),
    ];
    guards.push(
      `EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ${literal(table)} AND sql IN (${sqlForms.map(literal).join(', ')}))`
    );
    const columns = aggregate(
      array([
        'cid',
        bounded('name'),
        bounded('type'),
        '"notnull"',
        bounded('dflt_value', 512),
        'pk',
        'hidden',
      ]),
      `SELECT * FROM pragma_table_xinfo(${literal(table)}) ORDER BY cid LIMIT 65`
    );
    guards.push(`${columns} = ${literal(JSON.stringify(expected.columns))}`);
    const foreignKeys = aggregate(
      array([
        'id',
        'seq',
        bounded('"table"'),
        bounded('"from"'),
        bounded('"to"'),
        bounded('on_update'),
        bounded('on_delete'),
        bounded('match'),
      ]),
      `SELECT * FROM pragma_foreign_key_list(${literal(table)}) ORDER BY id, seq LIMIT 65`
    );
    guards.push(
      `${foreignKeys} = ${literal(JSON.stringify(expected.foreignKeys))}`
    );
    const indexes = expected.indexes.map((item) => [
      item.name,
      item.sql,
      item.unique,
      item.origin,
      item.partial,
      item.columns,
    ]);
    const indexColumns = aggregate(
      array([
        'seqno',
        'cid',
        bounded('name'),
        '"desc"',
        bounded('coll'),
        '"key"',
      ]),
      'SELECT * FROM pragma_index_xinfo(i.name) ORDER BY seqno LIMIT 65'
    );
    const indexRows = `(SELECT json_group_array(${array([
      bounded('i.name'),
      bounded(
        "(SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = i.name)",
        4096
      ),
      'i."unique"',
      bounded('i.origin'),
      'i.partial',
      `json(${indexColumns})`,
    ])}) FROM (SELECT * FROM pragma_index_list(${literal(table)}) ORDER BY name LIMIT ${expected.indexes.length + 1}) AS i)`;
    guards.push(`${indexRows} = ${literal(JSON.stringify(indexes))}`);
  }
  // Keeping this tree shallow avoids workerd's expression-depth ceiling as the full preflight grows.
  const combine = (parts: string[]): string => {
    if (parts.length === 1) return parts[0];
    const mid = Math.floor(parts.length / 2);
    return `(${combine(parts.slice(0, mid))} AND ${combine(parts.slice(mid))})`;
  };
  return combine(guards);
}
