// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
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
