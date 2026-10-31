DROP TRIGGER IF EXISTS `cloudforge_mfa_recovery_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_password_auth_version_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_factor_auth_version_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oauth_consent_revoked_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oauth_consent_insert_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oauth_consent_update_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oauth_refresh_insert_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oauth_access_insert_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_auth_policy_insert_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_auth_policy_update_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_configuration_retire_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_binding_owner_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_binding_revoked_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_registry_immutable_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_configuration_publish_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_binding_confirm_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_session_source_immutable_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_login_cancel_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_oidc_login_complete_v1`;
--> statement-breakpoint
CREATE INDEX `sessions_oidcBindingId_idx` ON `sessions` (`oidc_binding_id`);--> statement-breakpoint
CREATE INDEX `oidc_login_binding_idx` ON `oidc_login_actions` (`binding_id`);
--> statement-breakpoint
CREATE TRIGGER `cloudforge_mfa_recovery_v1`
AFTER INSERT ON `mfa_recovery_events`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN
    NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id)
    OR EXISTS (SELECT 1 FROM agents WHERE user_id = NEW.user_id)
    THEN RAISE(ABORT, 'MFA recovery requires a person') END;
  UPDATE users SET auth_version = auth_version + CASE WHEN COALESCE(two_factor_enabled, 0) = 0 THEN 1 ELSE 0 END,
    two_factor_enabled = 0, updated_at = NEW.created_at WHERE id = NEW.user_id;
  DELETE FROM verifications WHERE identifier IN (
    SELECT '2fa-attempts-' || identifier FROM verifications
    WHERE value = NEW.user_id AND identifier LIKE '2fa-%'
  );
  DELETE FROM verifications WHERE value = NEW.user_id
    AND (identifier LIKE '2fa-%' OR identifier LIKE 'trust-device-%');
  DELETE FROM sessions WHERE user_id = NEW.user_id;
  DELETE FROM two_factors WHERE user_id = NEW.user_id;
  INSERT INTO audit_events
    (id, repository_id, actor_id, actor_kind, via, action, target, data, created_at)
    SELECT NEW.id, NULL, NULL, 'system', 'cloudforge reset-mfa', 'user.mfa_reset',
      '@' || COALESCE(username, email, id),
      json_object('userId', NEW.user_id, 'reason', NEW.reason, 'recoveryId', NEW.id), NEW.created_at
    FROM users WHERE id = NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_password_auth_version_v1`
AFTER UPDATE OF password ON accounts
FOR EACH ROW WHEN NEW.provider_id = 'credential' AND NEW.password IS NOT OLD.password
BEGIN
  UPDATE users SET auth_version = auth_version + 1 WHERE id = NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_factor_auth_version_v1`
AFTER UPDATE OF two_factor_enabled ON users
FOR EACH ROW WHEN COALESCE(NEW.two_factor_enabled, 0) != COALESCE(OLD.two_factor_enabled, 0)
BEGIN
  UPDATE users SET auth_version = auth_version + 1 WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oauth_consent_revoked_v1`
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
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oauth_consent_insert_v1`
BEFORE INSERT ON oauth_consents
FOR EACH ROW WHEN NEW.user_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT (EXISTS (SELECT 1 FROM oauth_grant_generations g
    WHERE g.user_id = NEW.user_id AND g.client_id = NEW.client_id
    AND ((COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NEW.reference_id = 'cf-grant-v1:' || g.generation)
      OR (COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) > 0 AND NEW.reference_id = 'cf-grant-v2:' || COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) || ':' || g.generation))) OR (NEW.reference_id IS NULL AND COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NOT EXISTS (
    SELECT 1 FROM oauth_grant_generations g WHERE g.user_id = NEW.user_id
    AND g.client_id = NEW.client_id AND g.legacy_revoked = 1)))
    THEN RAISE(ABORT, 'OAuth authorization was revoked') END;
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oauth_consent_update_v1`
BEFORE UPDATE ON oauth_consents
FOR EACH ROW WHEN NEW.user_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT (EXISTS (SELECT 1 FROM oauth_grant_generations g
    WHERE g.user_id = NEW.user_id AND g.client_id = NEW.client_id
    AND ((COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NEW.reference_id = 'cf-grant-v1:' || g.generation)
      OR (COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) > 0 AND NEW.reference_id = 'cf-grant-v2:' || COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) || ':' || g.generation))) OR (NEW.reference_id IS NULL AND COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NOT EXISTS (
    SELECT 1 FROM oauth_grant_generations g WHERE g.user_id = NEW.user_id
    AND g.client_id = NEW.client_id AND g.legacy_revoked = 1)))
    THEN RAISE(ABORT, 'OAuth authorization was revoked') END;
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oauth_refresh_insert_v1`
BEFORE INSERT ON oauth_refresh_tokens
FOR EACH ROW WHEN NEW.user_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT (EXISTS (SELECT 1 FROM oauth_grant_generations g
    WHERE g.user_id = NEW.user_id AND g.client_id = NEW.client_id
    AND ((COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NEW.reference_id = 'cf-grant-v1:' || g.generation)
      OR (COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) > 0 AND NEW.reference_id = 'cf-grant-v2:' || COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) || ':' || g.generation))) OR (NEW.reference_id IS NULL AND COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NOT EXISTS (
    SELECT 1 FROM oauth_grant_generations g WHERE g.user_id = NEW.user_id
    AND g.client_id = NEW.client_id AND g.legacy_revoked = 1)))
    THEN RAISE(ABORT, 'OAuth authorization was revoked') END;
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oauth_access_insert_v1`
BEFORE INSERT ON oauth_access_tokens
FOR EACH ROW WHEN NEW.user_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT (EXISTS (SELECT 1 FROM oauth_grant_generations g
    WHERE g.user_id = NEW.user_id AND g.client_id = NEW.client_id
    AND ((COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NEW.reference_id = 'cf-grant-v1:' || g.generation)
      OR (COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) > 0 AND NEW.reference_id = 'cf-grant-v2:' || COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) || ':' || g.generation))) OR (NEW.reference_id IS NULL AND COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0) = 0 AND NOT EXISTS (
    SELECT 1 FROM oauth_grant_generations g WHERE g.user_id = NEW.user_id
    AND g.client_id = NEW.client_id AND g.legacy_revoked = 1)))
    THEN RAISE(ABORT, 'OAuth authorization was revoked') END;
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_auth_policy_insert_v1`
AFTER INSERT ON authentication_policy FOR EACH ROW WHEN NEW.version > 0
BEGIN
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
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_auth_policy_update_v1`
AFTER UPDATE ON authentication_policy FOR EACH ROW WHEN NEW.version != OLD.version
BEGIN
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
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oidc_configuration_retire_v1`
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
  DELETE FROM sessions WHERE oidc_binding_id IS NOT NULL;
  UPDATE oidc_login_actions SET status='cancelled',sealed=NULL,factor_secret=NULL WHERE status IN ('pending','exchanging','ready','enrollment_required');
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oidc_binding_owner_v1`
BEFORE UPDATE ON oidc_bindings FOR EACH ROW
WHEN NEW.id != OLD.id OR NEW.provider_id != OLD.provider_id OR NEW.issuer != OLD.issuer OR NEW.subject != OLD.subject
  OR (NEW.user_id IS NOT OLD.user_id AND NEW.user_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'OIDC identity ownership is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oidc_binding_revoked_v1`
AFTER UPDATE OF active ON oidc_bindings FOR EACH ROW WHEN OLD.active=1 AND NEW.active=0
BEGIN
  UPDATE oidc_link_actions SET status='cancelled',capability_hash=NULL,state_hash=NULL,cookie_hash=NULL,sealed=NULL,
    subject=NULL,email=NULL,name=NULL
    WHERE user_id=OLD.user_id AND provider_id=OLD.provider_id AND kind='link'
      AND status IN ('preview','await_callback','exchanging','candidate');
  DELETE FROM sessions WHERE oidc_binding_id=OLD.id;
  UPDATE oidc_login_actions SET status='cancelled',sealed=NULL,factor_secret=NULL WHERE binding_id=OLD.id AND status IN ('pending','exchanging','ready','enrollment_required');
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oidc_registry_immutable_v1`
BEFORE UPDATE ON oidc_providers FOR EACH ROW
WHEN NEW.id != OLD.id OR NEW.issuer != OLD.issuer OR NEW.version < OLD.version
  OR (NEW.version = OLD.version AND NEW.digest != OLD.digest)
BEGIN SELECT RAISE(ABORT, 'OIDC provider identity or version changed'); END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oidc_configuration_publish_v1`
AFTER UPDATE OF status ON oidc_link_actions FOR EACH ROW
WHEN NEW.kind = 'configure' AND OLD.status = 'preview' AND NEW.status = 'confirmed'
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM oidc_providers WHERE id = NEW.provider_id
    AND (issuer != NEW.issuer OR version >= NEW.provider_version))
    THEN RAISE(ABORT, 'OIDC provider identity or version changed') END;
  INSERT INTO oidc_providers (id,issuer,version,digest,created_at)
    VALUES (NEW.provider_id,NEW.issuer,NEW.provider_version,NEW.provider_digest,NEW.completed_at)
    ON CONFLICT(id) DO UPDATE SET version=excluded.version,digest=excluded.digest;
  INSERT INTO oidc_configuration (id,enabled,login_enabled,provider_id,version,digest,generation,action_id,updated_at)
    VALUES (1,1,NEW.login_enabled,NEW.provider_id,NEW.provider_version,NEW.provider_digest,NEW.configuration_generation+1,NEW.id,NEW.completed_at)
    ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,version=excluded.version,digest=excluded.digest,
      enabled=1,login_enabled=excluded.login_enabled,generation=excluded.generation,action_id=excluded.action_id,updated_at=excluded.updated_at
    WHERE oidc_configuration.generation=NEW.configuration_generation;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM oidc_configuration WHERE action_id=NEW.id)
    THEN RAISE(ABORT, 'OIDC configuration changed') END;
  DELETE FROM sessions WHERE oidc_binding_id IS NOT NULL;
  UPDATE oidc_login_actions SET status='cancelled',sealed=NULL,factor_secret=NULL WHERE status IN ('pending','exchanging','ready','enrollment_required');
END;
--> statement-breakpoint
CREATE TRIGGER `cloudforge_oidc_binding_confirm_v1`
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
END;
--> statement-breakpoint
CREATE TRIGGER cloudforge_oidc_session_source_immutable_v1 BEFORE UPDATE ON sessions FOR EACH ROW
    WHEN OLD.oidc_binding_id IS NOT NULL AND (NEW.oidc_binding_id IS NOT OLD.oidc_binding_id
      OR NEW.oidc_binding_revision IS NOT OLD.oidc_binding_revision
      OR NEW.oidc_configuration_generation IS NOT OLD.oidc_configuration_generation)
    BEGIN SELECT RAISE(ABORT, 'OIDC session source is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER cloudforge_oidc_login_cancel_v1 AFTER UPDATE OF status ON oidc_login_actions FOR EACH ROW
    WHEN NEW.status='cancelled' AND OLD.status!='cancelled'
    BEGIN
      DELETE FROM sessions WHERE id=OLD.session_id AND oidc_binding_id=OLD.binding_id;
      UPDATE oidc_login_actions SET sealed=NULL,factor_secret=NULL,backup_before=NULL,backup_after=NULL WHERE id=NEW.id;
    END;
--> statement-breakpoint
CREATE TRIGGER cloudforge_oidc_login_complete_v1 AFTER UPDATE OF status ON oidc_login_actions FOR EACH ROW
    WHEN OLD.status='ready' AND NEW.status='signed_in'
    BEGIN
      SELECT CASE WHEN NOT (NEW.expires_at>NEW.completed_at AND NEW.policy_version=COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0)
    AND EXISTS (SELECT 1 FROM oidc_configuration c JOIN oidc_providers p ON p.id=c.provider_id
      WHERE c.id=1 AND c.enabled=1 AND c.login_enabled=1 AND c.provider_id=NEW.provider_id
      AND p.issuer=NEW.issuer AND c.version=NEW.provider_version AND c.digest=NEW.provider_digest
      AND c.generation=NEW.configuration_generation)
    AND EXISTS (SELECT 1 FROM oidc_bindings b JOIN users u ON u.id=b.user_id LEFT JOIN two_factors f ON f.user_id=u.id
      WHERE b.id=NEW.binding_id AND b.active=1 AND b.revision=NEW.binding_revision AND b.user_id=NEW.user_id
      AND b.provider_id=NEW.provider_id AND b.issuer=NEW.issuer AND coalesce(u.banned,0)=0
      AND NOT EXISTS (SELECT 1 FROM agents WHERE user_id=u.id) AND u.auth_version=NEW.auth_version
      AND coalesce(u.two_factor_enabled,0)=NEW.factor_enabled AND f.id IS NEW.factor_id
      AND f.secret IS NEW.factor_secret AND f.recovery_version IS NEW.recovery_version
      AND (NEW.factor_enabled=0 OR f.verified=1)))
        OR (NEW.factor_enabled=0 AND COALESCE((SELECT require_mfa FROM authentication_policy WHERE id = 1), 0)=1)
        OR NEW.primary_time IS NULL OR NEW.primary_time>NEW.completed_at OR NEW.primary_time<NEW.created_at
        THEN RAISE(ABORT, 'OIDC login changed') END;
      UPDATE two_factors SET last_totp_step=NEW.factor_step,failed_verification_count=0,locked_until=NULL
        WHERE NEW.factor_enabled=1 AND NEW.factor_method='totp' AND id=NEW.factor_id
          AND secret=NEW.factor_secret AND verified=1 AND coalesce(last_totp_step,0)<NEW.factor_step;
      SELECT CASE WHEN NEW.factor_enabled=1 AND NEW.factor_method='totp' AND changes()!=1
        THEN RAISE(ABORT, 'OIDC factor changed') END;
      UPDATE two_factors SET backup_codes=NEW.backup_after,failed_verification_count=0,locked_until=NULL
        WHERE NEW.factor_enabled=1 AND NEW.factor_method='recovery_code' AND id=NEW.factor_id
          AND secret=NEW.factor_secret AND verified=1 AND backup_codes=NEW.backup_before AND NEW.backup_after IS NOT NULL;
      SELECT CASE WHEN NEW.factor_enabled=1 AND (NEW.factor_method IS NULL OR NEW.factor_method NOT IN ('totp','recovery_code'))
        OR (NEW.factor_enabled=1 AND NEW.factor_method='recovery_code' AND changes()!=1)
        THEN RAISE(ABORT, 'OIDC factor changed') END;
      UPDATE sessions SET auth_method='oidc',auth_time=NEW.primary_time,policy_version=NEW.policy_version,
        second_factor_method=CASE WHEN NEW.factor_enabled=1 THEN NEW.factor_method ELSE NULL END,
        second_factor_time=CASE WHEN NEW.factor_enabled=1 THEN NEW.completed_at ELSE NULL END,
        oidc_binding_id=NEW.binding_id,oidc_binding_revision=NEW.binding_revision,
        oidc_configuration_generation=NEW.configuration_generation
        WHERE id=NEW.session_id AND user_id=NEW.user_id AND auth_version=NEW.auth_version
          AND expires_at>NEW.completed_at AND oidc_binding_id IS NULL AND oidc_binding_revision IS NULL
          AND oidc_configuration_generation IS NULL AND auth_method IS NULL AND coalesce(impersonated_by,'')='';
      SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT, 'OIDC session changed') END;
      UPDATE oidc_login_actions SET sealed=NULL,factor_secret=NULL,backup_before=NULL,backup_after=NULL WHERE id=NEW.id;
    END;
