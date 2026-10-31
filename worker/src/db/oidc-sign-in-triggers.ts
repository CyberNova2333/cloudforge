// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
const POLICY_VERSION_SQL =
  'COALESCE((SELECT version FROM authentication_policy WHERE id = 1), 0)';
const POLICY_REQUIRE_MFA_SQL =
  'COALESCE((SELECT require_mfa FROM authentication_policy WHERE id = 1), 0)';

/** Shared write fence. The table alias is internal, never user input. */
export function loginAuthority(a: 'a' | 'NEW', now: number | string) {
  return `${a}.expires_at>${now} AND ${a}.policy_version=${POLICY_VERSION_SQL}
    AND EXISTS (SELECT 1 FROM oidc_configuration c JOIN oidc_providers p ON p.id=c.provider_id
      WHERE c.id=1 AND c.enabled=1 AND c.login_enabled=1 AND c.provider_id=${a}.provider_id
      AND p.issuer=${a}.issuer AND c.version=${a}.provider_version AND c.digest=${a}.provider_digest
      AND c.generation=${a}.configuration_generation)
    AND EXISTS (SELECT 1 FROM oidc_bindings b JOIN users u ON u.id=b.user_id LEFT JOIN two_factors f ON f.user_id=u.id
      WHERE b.id=${a}.binding_id AND b.active=1 AND b.revision=${a}.binding_revision AND b.user_id=${a}.user_id
      AND b.provider_id=${a}.provider_id AND b.issuer=${a}.issuer AND coalesce(u.banned,0)=0
      AND NOT EXISTS (SELECT 1 FROM agents WHERE user_id=u.id) AND u.auth_version=${a}.auth_version
      AND coalesce(u.two_factor_enabled,0)=${a}.factor_enabled AND f.id IS ${a}.factor_id
      AND f.secret IS ${a}.factor_secret AND f.recovery_version IS ${a}.recovery_version
      AND (${a}.factor_enabled=0 OR f.verified=1))`;
}
export const OIDC_SIGN_IN_TRIGGERS = [
  {
    name: 'cloudforge_oidc_session_source_immutable_v1',
    sql: `CREATE TRIGGER cloudforge_oidc_session_source_immutable_v1 BEFORE UPDATE ON sessions FOR EACH ROW
    WHEN OLD.oidc_binding_id IS NOT NULL AND (NEW.oidc_binding_id IS NOT OLD.oidc_binding_id
      OR NEW.oidc_binding_revision IS NOT OLD.oidc_binding_revision
      OR NEW.oidc_configuration_generation IS NOT OLD.oidc_configuration_generation)
    BEGIN SELECT RAISE(ABORT, 'OIDC session source is immutable'); END`,
  },
  {
    name: 'cloudforge_oidc_login_cancel_v1',
    sql: `CREATE TRIGGER cloudforge_oidc_login_cancel_v1 AFTER UPDATE OF status ON oidc_login_actions FOR EACH ROW
    WHEN NEW.status='cancelled' AND OLD.status!='cancelled'
    BEGIN
      DELETE FROM sessions WHERE id=OLD.session_id AND oidc_binding_id=OLD.binding_id;
      UPDATE oidc_login_actions SET sealed=NULL,factor_secret=NULL,backup_before=NULL,backup_after=NULL WHERE id=NEW.id;
    END`,
  },
  {
    name: 'cloudforge_oidc_login_complete_v1',
    sql: `CREATE TRIGGER cloudforge_oidc_login_complete_v1 AFTER UPDATE OF status ON oidc_login_actions FOR EACH ROW
    WHEN OLD.status='ready' AND NEW.status='signed_in'
    BEGIN
      SELECT CASE WHEN NOT (${loginAuthority('NEW', 'NEW.completed_at')})
        OR (NEW.factor_enabled=0 AND ${POLICY_REQUIRE_MFA_SQL}=1)
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
    END`,
  },
];
