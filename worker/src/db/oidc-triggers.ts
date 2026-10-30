/** Declarative SQL only; the migration generator owns the deployed definitions. */
export const OIDC_TRIGGERS = [
  {
    name: 'cloudforge_oidc_configuration_retire_v1',
    sql: `CREATE TRIGGER \`cloudforge_oidc_configuration_retire_v1\`
AFTER UPDATE OF status ON oidc_link_actions FOR EACH ROW
WHEN NEW.kind='retire' AND OLD.status='preview' AND NEW.status='confirmed'
BEGIN
  UPDATE oidc_configuration SET enabled=0,digest='retired:' || NEW.id,generation=generation+1,action_id=NEW.id,updated_at=NEW.completed_at
    WHERE id=1 AND enabled=1 AND generation=NEW.configuration_generation AND provider_id=NEW.provider_id
      AND version=NEW.provider_version AND digest=NEW.provider_digest;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM oidc_configuration WHERE action_id=NEW.id AND enabled=0)
    THEN RAISE(ABORT, 'OIDC configuration changed') END;
  UPDATE oidc_link_actions SET status='cancelled',capability_hash=NULL,state_hash=NULL,cookie_hash=NULL,sealed=NULL,
    subject=NULL,email=NULL,name=NULL
    WHERE kind='link' AND status IN ('preview','await_callback','exchanging','candidate');
END`,
  },
  {
    name: 'cloudforge_oidc_binding_owner_v1',
    sql: `CREATE TRIGGER \`cloudforge_oidc_binding_owner_v1\`
BEFORE UPDATE ON oidc_bindings FOR EACH ROW
WHEN NEW.id != OLD.id OR NEW.provider_id != OLD.provider_id OR NEW.issuer != OLD.issuer OR NEW.subject != OLD.subject
  OR (NEW.user_id IS NOT OLD.user_id AND NEW.user_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'OIDC identity ownership is permanent'); END`,
  },
  {
    name: 'cloudforge_oidc_binding_revoked_v1',
    sql: `CREATE TRIGGER \`cloudforge_oidc_binding_revoked_v1\`
AFTER UPDATE OF active ON oidc_bindings FOR EACH ROW WHEN OLD.active=1 AND NEW.active=0
BEGIN
  UPDATE oidc_link_actions SET status='cancelled',capability_hash=NULL,state_hash=NULL,cookie_hash=NULL,sealed=NULL,
    subject=NULL,email=NULL,name=NULL
    WHERE user_id=OLD.user_id AND provider_id=OLD.provider_id AND kind='link'
      AND status IN ('preview','await_callback','exchanging','candidate');
END`,
  },
  {
    name: 'cloudforge_oidc_registry_immutable_v1',
    sql: `CREATE TRIGGER \`cloudforge_oidc_registry_immutable_v1\`
BEFORE UPDATE ON oidc_providers FOR EACH ROW
WHEN NEW.id != OLD.id OR NEW.issuer != OLD.issuer OR NEW.version < OLD.version
  OR (NEW.version = OLD.version AND NEW.digest != OLD.digest)
BEGIN SELECT RAISE(ABORT, 'OIDC provider identity or version changed'); END`,
  },
  {
    name: 'cloudforge_oidc_configuration_publish_v1',
    sql: `CREATE TRIGGER \`cloudforge_oidc_configuration_publish_v1\`
AFTER UPDATE OF status ON oidc_link_actions FOR EACH ROW
WHEN NEW.kind = 'configure' AND OLD.status = 'preview' AND NEW.status = 'confirmed'
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM oidc_providers WHERE id = NEW.provider_id
    AND (issuer != NEW.issuer OR version >= NEW.provider_version))
    THEN RAISE(ABORT, 'OIDC provider identity or version changed') END;
  INSERT INTO oidc_providers (id,issuer,version,digest,created_at)
    VALUES (NEW.provider_id,NEW.issuer,NEW.provider_version,NEW.provider_digest,NEW.completed_at)
    ON CONFLICT(id) DO UPDATE SET version=excluded.version,digest=excluded.digest;
  INSERT INTO oidc_configuration (id,enabled,provider_id,version,digest,generation,action_id,updated_at)
    VALUES (1,1,NEW.provider_id,NEW.provider_version,NEW.provider_digest,NEW.configuration_generation+1,NEW.id,NEW.completed_at)
    ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,version=excluded.version,digest=excluded.digest,
      enabled=1,generation=excluded.generation,action_id=excluded.action_id,updated_at=excluded.updated_at
    WHERE oidc_configuration.generation=NEW.configuration_generation;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM oidc_configuration WHERE action_id=NEW.id)
    THEN RAISE(ABORT, 'OIDC configuration changed') END;
END`,
  },
  {
    name: 'cloudforge_oidc_binding_confirm_v1',
    sql: `CREATE TRIGGER \`cloudforge_oidc_binding_confirm_v1\`
AFTER UPDATE OF status ON oidc_link_actions FOR EACH ROW
WHEN NEW.kind='link' AND OLD.status='candidate' AND NEW.status='confirmed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM oidc_configuration c JOIN oidc_providers p ON p.id=c.provider_id
    WHERE c.id=1 AND c.enabled=1 AND c.provider_id=NEW.provider_id AND p.issuer=NEW.issuer
      AND c.version=NEW.provider_version AND c.digest=NEW.provider_digest AND c.generation=NEW.configuration_generation)
    THEN RAISE(ABORT, 'OIDC configuration changed') END;
  INSERT INTO oidc_bindings (id,provider_id,issuer,subject,user_id,active,revision,email,name,created_at,updated_at)
    VALUES (NEW.binding_id,NEW.provider_id,NEW.issuer,NEW.subject,NEW.user_id,1,1,NEW.email,NEW.name,NEW.completed_at,NEW.completed_at)
    ON CONFLICT(issuer,subject) DO UPDATE SET active=1,revision=oidc_bindings.revision+1,email=excluded.email,
      name=excluded.name,updated_at=excluded.updated_at
    WHERE oidc_bindings.user_id=NEW.user_id AND oidc_bindings.provider_id=NEW.provider_id AND oidc_bindings.active=0;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM oidc_bindings WHERE issuer=NEW.issuer AND subject=NEW.subject
    AND user_id=NEW.user_id AND provider_id=NEW.provider_id AND active=1)
    THEN RAISE(ABORT, 'OIDC identity already reserved') END;
  UPDATE oidc_link_actions SET binding_id=(SELECT id FROM oidc_bindings WHERE issuer=NEW.issuer AND subject=NEW.subject),
    binding_revision=(SELECT revision FROM oidc_bindings WHERE issuer=NEW.issuer AND subject=NEW.subject) WHERE id=NEW.id;
END`,
  },
];
