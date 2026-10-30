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
CREATE TABLE `authentication_policy` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`require_mfa` integer DEFAULT false NOT NULL,
	`change_id` text,
	`preview_id` text,
	`actor_session_id` text,
	`updated_by_id` text,
	`updated_at` integer,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "authentication_policy_singleton" CHECK("authentication_policy"."id" = 1 AND "authentication_policy"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE `authentication_policy_previews` (
	`session_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`policy_version` integer NOT NULL,
	`require_mfa` integer NOT NULL,
	`auth_version` integer NOT NULL,
	`factor_id` text NOT NULL,
	`recovery_version` integer NOT NULL,
	`auth_time` integer NOT NULL,
	`factor_time` integer NOT NULL,
	`digest` text NOT NULL,
	`impact` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authentication_policy_previews_id_unique` ON `authentication_policy_previews` (`id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `policy_version` integer DEFAULT 0 NOT NULL;
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
