DROP TRIGGER IF EXISTS `cloudforge_mfa_recovery_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_password_auth_version_v1`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cloudforge_factor_auth_version_v1`;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_method` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_time` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `second_factor_method` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `second_factor_time` integer;--> statement-breakpoint
ALTER TABLE `two_factors` ADD `recovery_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `auth_version` integer DEFAULT 0 NOT NULL;
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
