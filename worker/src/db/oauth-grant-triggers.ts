// Declarative source: the generator adds these to a new migration; never edit migration history.
const policyVersion =
  'COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0)';
const currentReference = `EXISTS (SELECT 1 FROM oauth_grant_generations g
    WHERE g.user_id = NEW.user_id AND g.client_id = NEW.client_id
    AND ((${policyVersion} = 0 AND NEW.reference_id = 'cf-grant-v1:' || g.generation)
      OR (${policyVersion} > 0 AND NEW.reference_id = 'cf-grant-v2:' || ${policyVersion} || ':' || g.generation)))`;
const legacyAllowed = `(NEW.reference_id IS NULL AND ${policyVersion} = 0 AND NOT EXISTS (
    SELECT 1 FROM oauth_grant_generations g WHERE g.user_id = NEW.user_id
    AND g.client_id = NEW.client_id AND g.legacy_revoked = 1))`;

export const OAUTH_GRANT_TRIGGERS = [
  {
    name: 'cloudforge_oauth_consent_revoked_v1',
    sql: `CREATE TRIGGER \`cloudforge_oauth_consent_revoked_v1\`
AFTER DELETE ON oauth_consents
FOR EACH ROW WHEN OLD.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
  AND EXISTS (SELECT 1 FROM oauth_clients WHERE client_id = OLD.client_id)
BEGIN
  INSERT INTO oauth_grant_generations (user_id, client_id, generation, legacy_revoked)
  VALUES (OLD.user_id, OLD.client_id, lower(hex(randomblob(16))), 1)
  ON CONFLICT (user_id, client_id) DO UPDATE SET generation = excluded.generation, legacy_revoked = 1;
  DELETE FROM oauth_access_tokens WHERE user_id = OLD.user_id AND client_id = OLD.client_id;
  DELETE FROM oauth_refresh_tokens WHERE user_id = OLD.user_id AND client_id = OLD.client_id;
END`,
  },
  ...['INSERT', 'UPDATE'].map((operation) => ({
    name: `cloudforge_oauth_consent_${operation.toLowerCase()}_v1`,
    sql: `CREATE TRIGGER \`cloudforge_oauth_consent_${operation.toLowerCase()}_v1\`
BEFORE ${operation} ON oauth_consents
FOR EACH ROW WHEN NEW.user_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT (${currentReference} OR ${legacyAllowed})
    THEN RAISE(ABORT, 'OAuth authorization was revoked') END;
END`,
  })),
  ...['refresh', 'access'].map((kind) => ({
    name: `cloudforge_oauth_${kind}_insert_v1`,
    sql: `CREATE TRIGGER \`cloudforge_oauth_${kind}_insert_v1\`
BEFORE INSERT ON oauth_${kind}_tokens
FOR EACH ROW WHEN NEW.user_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT (${currentReference} OR ${legacyAllowed})
    THEN RAISE(ABORT, 'OAuth authorization was revoked') END;
END`,
  })),
];
