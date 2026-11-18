// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: AGPL-3.0-only.
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
/** Immutable one-time bootstrap. The generator records id/hash and never re-emits applied seeds. */
export const ACCESS_BACKFILLS = [
  {
    id: 'access_compat_v1',
    statements: [
      `INSERT INTO access_control_state (id, generation, legacy_shared_team_id)
VALUES (1, 0, (SELECT id FROM teams LIMIT 1));`,
    ],
  },
];
