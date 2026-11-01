// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
/** Immutable seed for the first admission-aware runtime; future floor changes must never reseed it. */
export const ACCESS_RUNTIME_BACKFILLS = [
  {
    id: 'access_runtime_bridge_v1',
    statements: [
      `INSERT INTO access_runtime_state (id, minimum_protocol, schema_mode, role_publishing_enabled, revision)
VALUES (1, 1, 'compat-v1', 0, 0);`,
    ],
  },
];
