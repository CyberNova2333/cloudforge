// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.

/** Empty initialization or the same owner only; every ownership check is in this write statement. */
export const INSTALL_MARKER_WRITE_SQL = `INSERT INTO install_state
  (installation_id, ownership_nonce, version, manifest_json, updated_at)
SELECT ?, ?, ?, ?, ?
WHERE (SELECT count(*) FROM install_state) <= 1
  AND NOT EXISTS (
    SELECT 1 FROM install_state WHERE installation_id IS NOT ? OR ownership_nonce IS NOT ?
  )
ON CONFLICT (installation_id) DO UPDATE SET
  version = excluded.version,
  manifest_json = excluded.manifest_json,
  updated_at = excluded.updated_at
WHERE install_state.ownership_nonce = excluded.ownership_nonce
RETURNING installation_id AS written`;
