// CloudForge fork addition (2026-11-01). SPDX-License-Identifier: GPL-3.0-or-later.
const MAX = 9007199254740991;
const integer = (value: string, minimum = 0) =>
  `typeof(${value}) = 'integer' AND ${value} >= ${minimum} AND ${value} <= ${MAX}`;
const valid = `NEW.id IS 1 AND (${integer('NEW.minimum_protocol', 1)}) AND NEW.schema_mode IS 'compat-v1' AND NEW.role_publishing_enabled IS 0 AND (${integer('NEW.revision')})`;
const present = `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM access_control_state WHERE id = 1) THEN RAISE(ABORT, 'CloudForge access state missing') END;`;
const make = (name: string, event: string, body: string) => ({
  name: `cloudforge_runtime_${name}_v1`,
  sql: `CREATE TRIGGER cloudforge_runtime_${name}_v1 ${event} FOR EACH ROW
BEGIN
${body}
END`,
});

/** The floor is permanent and monotonic. Unknown pre-bridge Workers do not obey this fence. */
export const ACCESS_RUNTIME_TRIGGERS = [
  make(
    'state_insert',
    'BEFORE INSERT ON access_runtime_state',
    `${present}
SELECT CASE WHEN EXISTS (SELECT 1 FROM access_runtime_state) OR NOT (${valid}) OR NEW.minimum_protocol != 1 OR NEW.revision != 0
THEN RAISE(ABORT, 'CloudForge runtime bootstrap invalid') END;`
  ),
  make(
    'state_update',
    'BEFORE UPDATE ON access_runtime_state',
    `${present}
SELECT CASE WHEN NOT (${valid}) OR NEW.id IS NOT OLD.id OR NEW.minimum_protocol < OLD.minimum_protocol OR NEW.revision != OLD.revision + 1
THEN RAISE(ABORT, 'CloudForge runtime transition invalid') END;`
  ),
  make(
    'state_updated',
    'AFTER UPDATE ON access_runtime_state',
    `UPDATE access_control_state SET generation = generation + 1 WHERE id = 1;`
  ),
  make(
    'state_delete',
    'BEFORE DELETE ON access_runtime_state',
    `SELECT RAISE(ABORT, 'CloudForge runtime state cannot be deleted');`
  ),
];
