// CloudForge fork addition (2026-10-31). SPDX-License-Identifier: GPL-3.0-or-later.
// These guards keep the legacy model safe while new role/team APIs are still unavailable.
const MAX = 9007199254740991;
const present = `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM access_control_state WHERE id = 1) THEN RAISE(ABORT, 'CloudForge access state missing') END;`;
const advance = `UPDATE access_control_state SET generation = generation + 1 WHERE id = 1;`;
const make = (name: string, event: string, body: string, when = '') => ({
  name: `cloudforge_access_${name}_v1`,
  sql: `CREATE TRIGGER cloudforge_access_${name}_v1 ${event} FOR EACH ROW${when ? ` WHEN ${when}` : ''}
BEGIN
${body}
END`,
});
const integer = (value: string) =>
  `typeof(${value}) = 'integer' AND ${value} >= 0 AND ${value} <= ${MAX}`;
const namespace = (kind: 'user' | 'team', field: string, id: string) => `
SELECT CASE WHEN ${field} IS NOT NULL AND (typeof(${field}) != 'text' OR length(${field}) = 0 OR
  EXISTS (SELECT 1 FROM users WHERE username IS NOT NULL AND lower(username) = lower(${field}) AND NOT ('${kind}' = 'user' AND users.id = ${id})) OR
  EXISTS (SELECT 1 FROM teams WHERE lower(slug) = lower(${field}) AND NOT ('${kind}' = 'team' AND teams.id = ${id})) OR
  EXISTS (SELECT 1 FROM namespace_claims WHERE slug = lower(${field}) AND NOT (kind = '${kind}' AND subject_id = ${id})))
THEN RAISE(ABORT, 'CloudForge namespace conflict') END;`;
const pointer = `(SELECT count(*) FROM teams) > 1 OR EXISTS (SELECT 1 FROM teams WHERE membership_mode != 'instance') OR NEW.legacy_shared_team_id IS NOT (SELECT id FROM teams LIMIT 1)`;

/** Every privilege source is updated in the same SQL statement as its generation or the statement aborts. */
export const ACCESS_TRIGGERS = [
  make(
    'state_insert',
    'BEFORE INSERT ON access_control_state',
    `
SELECT CASE WHEN EXISTS (SELECT 1 FROM access_control_state) OR NEW.id IS NOT 1 OR NOT (${integer('NEW.generation')}) OR NEW.generation != 0
THEN RAISE(ABORT, 'CloudForge access state singleton') END;
SELECT CASE WHEN ${pointer} THEN RAISE(ABORT, 'CloudForge legacy team conflict') END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM namespace_claims) OR
  EXISTS (SELECT 1 FROM teams WHERE typeof(id) != 'text' OR length(id) = 0 OR typeof(slug) != 'text' OR length(slug) = 0 OR slug != lower(slug) OR NOT (${integer('revision')})) OR
  EXISTS (SELECT 1 FROM users WHERE typeof(id) != 'text' OR length(id) = 0 OR (username IS NOT NULL AND (typeof(username) != 'text' OR length(username) = 0))) OR
  EXISTS (SELECT 1 FROM repositories r LEFT JOIN users u ON u.id = r.owner_id LEFT JOIN teams t ON t.id = r.team_id WHERE u.id IS NULL OR (r.team_id IS NOT NULL AND (t.id IS NULL OR r.visibility = 'private'))) OR
  EXISTS (SELECT 1 FROM repository_collaborators c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN repositories r ON r.id = c.repository_id WHERE u.id IS NULL OR r.id IS NULL OR c.role IS NOT 'write' OR NOT (${integer('c.revision')})) OR
  EXISTS (SELECT 1 FROM agents a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN repositories r ON r.id = a.repository_id WHERE u.id IS NULL OR (a.repository_id IS NOT NULL AND (r.id IS NULL OR r.owner_id != a.user_id OR r.team_id IS NOT NULL)))
THEN RAISE(ABORT, 'CloudForge access bootstrap invalid') END;
SELECT CASE WHEN EXISTS (SELECT slug FROM (SELECT lower(username) AS slug FROM users WHERE username IS NOT NULL UNION ALL SELECT lower(slug) FROM teams) GROUP BY slug HAVING count(*) > 1)
THEN RAISE(ABORT, 'CloudForge namespace conflict') END;`
  ),
  make(
    'state_seed',
    'AFTER INSERT ON access_control_state',
    `
INSERT INTO namespace_claims (slug, kind, subject_id) SELECT lower(username), 'user', id FROM users WHERE username IS NOT NULL;
INSERT INTO namespace_claims (slug, kind, subject_id) SELECT lower(slug), 'team', id FROM teams;`
  ),
  make(
    'state_update',
    'BEFORE UPDATE ON access_control_state',
    `
SELECT CASE WHEN NEW.id IS NOT OLD.id OR NOT (${integer('NEW.generation')}) OR NEW.generation != OLD.generation + 1
THEN RAISE(ABORT, 'CloudForge access generation conflict') END;
SELECT CASE WHEN ${pointer} OR (OLD.legacy_shared_team_id IS NOT NULL AND EXISTS (SELECT 1 FROM teams WHERE id = OLD.legacy_shared_team_id) AND NEW.legacy_shared_team_id IS NOT OLD.legacy_shared_team_id)
THEN RAISE(ABORT, 'CloudForge legacy team conflict') END;`
  ),
  make(
    'state_delete',
    'BEFORE DELETE ON access_control_state',
    `SELECT RAISE(ABORT, 'CloudForge access state cannot be deleted');`
  ),
  make(
    'claim_insert',
    'BEFORE INSERT ON namespace_claims',
    `${present}
SELECT CASE WHEN typeof(NEW.slug) != 'text' OR length(NEW.slug) = 0 OR NEW.slug != lower(NEW.slug) OR typeof(NEW.subject_id) != 'text' OR length(NEW.subject_id) = 0 OR NEW.kind NOT IN ('user', 'team') OR
  EXISTS (SELECT 1 FROM namespace_claims WHERE slug = NEW.slug OR (kind = NEW.kind AND subject_id = NEW.subject_id)) OR
  NOT ((NEW.kind = 'user' AND EXISTS (SELECT 1 FROM users WHERE id = NEW.subject_id AND username IS NOT NULL AND lower(username) = NEW.slug)) OR
       (NEW.kind = 'team' AND EXISTS (SELECT 1 FROM teams WHERE id = NEW.subject_id AND lower(slug) = NEW.slug))) OR
  EXISTS (SELECT 1 FROM users WHERE username IS NOT NULL AND lower(username) = NEW.slug AND NOT (NEW.kind = 'user' AND id = NEW.subject_id)) OR
  EXISTS (SELECT 1 FROM teams WHERE lower(slug) = NEW.slug AND NOT (NEW.kind = 'team' AND id = NEW.subject_id))
THEN RAISE(ABORT, 'CloudForge namespace conflict') END;`
  ),
  make(
    'claim_update',
    'BEFORE UPDATE ON namespace_claims',
    `SELECT RAISE(ABORT, 'CloudForge namespace conflict');`
  ),
  make(
    'claim_delete',
    'BEFORE DELETE ON namespace_claims',
    `${present}
SELECT CASE WHEN (OLD.kind = 'user' AND EXISTS (SELECT 1 FROM users WHERE id = OLD.subject_id AND username IS NOT NULL AND lower(username) = OLD.slug)) OR
  (OLD.kind = 'team' AND EXISTS (SELECT 1 FROM teams WHERE id = OLD.subject_id AND lower(slug) = OLD.slug))
THEN RAISE(ABORT, 'CloudForge namespace conflict') END;`
  ),
  make(
    'user_insert',
    'BEFORE INSERT ON users',
    `${present}
SELECT CASE WHEN typeof(NEW.id) != 'text' OR length(NEW.id) = 0 OR EXISTS (SELECT 1 FROM users WHERE id = NEW.id OR email = NEW.email)
THEN RAISE(ABORT, 'CloudForge user identity conflict') END;
${namespace('user', 'NEW.username', 'NEW.id')}`
  ),
  make(
    'user_update',
    'BEFORE UPDATE OF id, email, username ON users',
    `${present}
SELECT CASE WHEN NEW.id IS NOT OLD.id OR EXISTS (SELECT 1 FROM users WHERE id != OLD.id AND email = NEW.email)
THEN RAISE(ABORT, 'CloudForge user identity conflict') END;
${namespace('user', 'NEW.username', 'OLD.id')}`
  ),
  make(
    'user_inserted',
    'AFTER INSERT ON users',
    `${present}
INSERT INTO namespace_claims (slug, kind, subject_id) SELECT lower(NEW.username), 'user', NEW.id WHERE NEW.username IS NOT NULL;
${advance}`
  ),
  make(
    'user_updated',
    'AFTER UPDATE OF username, role, banned ON users',
    `${present}
DELETE FROM namespace_claims WHERE kind = 'user' AND subject_id = OLD.id AND lower(NEW.username) IS NOT lower(OLD.username);
INSERT INTO namespace_claims (slug, kind, subject_id) SELECT lower(NEW.username), 'user', NEW.id WHERE NEW.username IS NOT NULL AND lower(NEW.username) IS NOT lower(OLD.username);
${advance}`,
    'NEW.username IS NOT OLD.username OR NEW.role IS NOT OLD.role OR NEW.banned IS NOT OLD.banned'
  ),
  make(
    'user_deleted',
    'AFTER DELETE ON users',
    `${present}
DELETE FROM namespace_claims WHERE kind = 'user' AND subject_id = OLD.id;
${advance}`
  ),
  make(
    'team_insert',
    'BEFORE INSERT ON teams',
    `${present}
SELECT CASE WHEN EXISTS (SELECT 1 FROM teams) OR (SELECT legacy_shared_team_id FROM access_control_state WHERE id = 1) IS NOT NULL OR typeof(NEW.id) != 'text' OR length(NEW.id) = 0 OR NEW.membership_mode IS NOT 'instance' OR NOT (${integer('NEW.revision')}) OR NEW.revision != 0
THEN RAISE(ABORT, 'CloudForge legacy team conflict') END;
SELECT CASE WHEN NEW.slug IS NULL OR NEW.slug != lower(NEW.slug) THEN RAISE(ABORT, 'CloudForge namespace conflict') END;
${namespace('team', 'NEW.slug', 'NEW.id')}`
  ),
  make(
    'team_update',
    'BEFORE UPDATE ON teams',
    `${present}
SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.membership_mode IS NOT 'instance' OR NOT (${integer('NEW.revision')}) OR (NEW.revision != OLD.revision AND (NEW.revision != OLD.revision + 1 OR NEW.name IS NOT OLD.name OR NEW.slug IS NOT OLD.slug)) OR NOT EXISTS (SELECT 1 FROM access_control_state WHERE id = 1 AND legacy_shared_team_id = OLD.id)
THEN RAISE(ABORT, 'CloudForge legacy team conflict') END;
SELECT CASE WHEN NEW.slug IS NULL OR NEW.slug != lower(NEW.slug) THEN RAISE(ABORT, 'CloudForge namespace conflict') END;
${namespace('team', 'NEW.slug', 'OLD.id')}`
  ),
  make(
    'team_inserted',
    'AFTER INSERT ON teams',
    `${present}
INSERT INTO namespace_claims (slug, kind, subject_id) VALUES (lower(NEW.slug), 'team', NEW.id);
UPDATE access_control_state SET generation = generation + 1, legacy_shared_team_id = NEW.id WHERE id = 1;`
  ),
  make(
    'team_updated',
    'AFTER UPDATE OF name, slug ON teams',
    `${present}
DELETE FROM namespace_claims WHERE kind = 'team' AND subject_id = OLD.id AND lower(NEW.slug) IS NOT lower(OLD.slug);
INSERT INTO namespace_claims (slug, kind, subject_id) SELECT lower(NEW.slug), 'team', NEW.id WHERE lower(NEW.slug) IS NOT lower(OLD.slug);
UPDATE teams SET revision = OLD.revision + 1 WHERE id = NEW.id;
${advance}`,
    'NEW.name IS NOT OLD.name OR NEW.slug IS NOT OLD.slug'
  ),
  make(
    'team_deleted',
    'AFTER DELETE ON teams',
    `${present}
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM access_control_state WHERE id = 1 AND legacy_shared_team_id = OLD.id) THEN RAISE(ABORT, 'CloudForge legacy team conflict') END;
DELETE FROM namespace_claims WHERE kind = 'team' AND subject_id = OLD.id;
UPDATE access_control_state SET generation = generation + 1, legacy_shared_team_id = NULL WHERE id = 1;`
  ),
  make(
    'collaborator_insert',
    'BEFORE INSERT ON repository_collaborators',
    `${present}
SELECT CASE WHEN NEW.role IS NOT 'write' OR NOT (${integer('NEW.revision')}) OR NEW.revision != 0 OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id) OR NOT EXISTS (SELECT 1 FROM repositories WHERE id = NEW.repository_id)
THEN RAISE(ABORT, 'CloudForge compatibility role conflict') END;
SELECT CASE WHEN EXISTS (SELECT 1 FROM repository_collaborators WHERE repository_id = NEW.repository_id AND user_id = NEW.user_id) THEN RAISE(IGNORE) END;`
  ),
  make(
    'collaborator_update',
    'BEFORE UPDATE ON repository_collaborators',
    `${present}
SELECT CASE WHEN NEW.user_id IS NOT OLD.user_id OR NEW.repository_id IS NOT OLD.repository_id OR NEW.role IS NOT 'write' OR NOT (${integer('NEW.revision')}) OR (NEW.revision != OLD.revision AND NEW.revision != OLD.revision + 1)
THEN RAISE(ABORT, 'CloudForge compatibility role conflict') END;`
  ),
  make(
    'collaborator_inserted',
    'AFTER INSERT ON repository_collaborators',
    `${present}
${advance}`
  ),
  make(
    'collaborator_updated',
    'AFTER UPDATE ON repository_collaborators',
    `${present}
${advance}`,
    'NEW.role IS NOT OLD.role OR NEW.created_at IS NOT OLD.created_at OR NEW.revision IS NOT OLD.revision'
  ),
  make(
    'collaborator_deleted',
    'AFTER DELETE ON repository_collaborators',
    `${present}
${advance}`
  ),
  make(
    'repository_insert',
    'BEFORE INSERT ON repositories',
    `${present}
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id) OR (NEW.team_id IS NOT NULL AND (NEW.visibility = 'private' OR NOT EXISTS (SELECT 1 FROM teams WHERE id = NEW.team_id AND membership_mode = 'instance')))
THEN RAISE(ABORT, 'CloudForge repository access conflict') END;`
  ),
  make(
    'repository_update',
    'BEFORE UPDATE OF id, owner_id, team_id, visibility ON repositories',
    `${present}
SELECT CASE WHEN NEW.id IS NOT OLD.id OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.owner_id) OR (NEW.team_id IS NOT NULL AND (NEW.visibility = 'private' OR NOT EXISTS (SELECT 1 FROM teams WHERE id = NEW.team_id AND membership_mode = 'instance')))
THEN RAISE(ABORT, 'CloudForge repository access conflict') END;`
  ),
  make(
    'repository_inserted',
    'AFTER INSERT ON repositories',
    `${present}
${advance}`
  ),
  make(
    'repository_updated',
    'AFTER UPDATE OF owner_id, team_id, visibility, name ON repositories',
    `${present}
${advance}`,
    'NEW.owner_id IS NOT OLD.owner_id OR NEW.team_id IS NOT OLD.team_id OR NEW.visibility IS NOT OLD.visibility OR NEW.name IS NOT OLD.name'
  ),
  make(
    'repository_deleted',
    'AFTER DELETE ON repositories',
    `${present}
${advance}`
  ),
  make(
    'agent_inserted',
    'AFTER INSERT ON agents',
    `${present}
${advance}`
  ),
  make(
    'agent_updated',
    'AFTER UPDATE OF user_id, deleted_at ON agents',
    `${present}
${advance}`,
    'NEW.user_id IS NOT OLD.user_id OR NEW.deleted_at IS NOT OLD.deleted_at'
  ),
  make(
    'agent_deleted',
    'AFTER DELETE ON agents',
    `${present}
${advance}`
  ),
];
