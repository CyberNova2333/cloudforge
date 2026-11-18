// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: AGPL-3.0-only.
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
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
