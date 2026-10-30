// Version changes revoke grants atomically; a no-op CAS must not revoke anything.
const effects = `
  UPDATE oauth_grant_generations SET generation = lower(hex(randomblob(16))), legacy_revoked = 1;
  DELETE FROM oauth_consents WHERE user_id IS NOT NULL;
  DELETE FROM oauth_access_tokens WHERE user_id IS NOT NULL;
  DELETE FROM oauth_refresh_tokens WHERE user_id IS NOT NULL;
  DELETE FROM verifications WHERE CASE WHEN json_valid(value) THEN json_extract(value, '$.type') ELSE NULL END = 'authorization_code';
  UPDATE authentication_policy_previews SET used_at = NEW.updated_at WHERE id = NEW.preview_id;
  UPDATE sessions SET policy_version = NEW.version WHERE id = NEW.actor_session_id AND user_id = NEW.updated_by_id;
  INSERT INTO audit_events (id, repository_id, actor_id, actor_kind, action, target, data, created_at)
    SELECT NEW.change_id, NULL, NEW.updated_by_id, 'person', 'instance.authentication_policy', 'authentication',
      json_object('version', NEW.version, 'requireMfa', json(CASE WHEN NEW.require_mfa = 1 THEN 'true' ELSE 'false' END)), NEW.updated_at
    WHERE NEW.change_id IS NOT NULL AND NEW.updated_by_id IS NOT NULL;
`;
export const AUTH_POLICY_TRIGGERS = [
  {
    name: 'cloudforge_auth_policy_insert_v1',
    sql: `CREATE TRIGGER \`cloudforge_auth_policy_insert_v1\`
AFTER INSERT ON authentication_policy FOR EACH ROW WHEN NEW.version > 0
BEGIN${effects}END`,
  },
  {
    name: 'cloudforge_auth_policy_update_v1',
    sql: `CREATE TRIGGER \`cloudforge_auth_policy_update_v1\`
AFTER UPDATE ON authentication_policy FOR EACH ROW WHEN NEW.version != OLD.version
BEGIN${effects}END`,
  },
];
