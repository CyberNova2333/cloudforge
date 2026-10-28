export const AUTH_TRIGGERS = [
  {
    name: 'cloudforge_password_auth_version_v1',
    sql: `CREATE TRIGGER \`cloudforge_password_auth_version_v1\`
AFTER UPDATE OF password ON accounts
FOR EACH ROW WHEN NEW.provider_id = 'credential' AND NEW.password IS NOT OLD.password
BEGIN
  UPDATE users SET auth_version = auth_version + 1 WHERE id = NEW.user_id;
END`,
  },
  {
    name: 'cloudforge_factor_auth_version_v1',
    sql: `CREATE TRIGGER \`cloudforge_factor_auth_version_v1\`
AFTER UPDATE OF two_factor_enabled ON users
FOR EACH ROW WHEN COALESCE(NEW.two_factor_enabled, 0) != COALESCE(OLD.two_factor_enabled, 0)
BEGIN
  UPDATE users SET auth_version = auth_version + 1 WHERE id = NEW.id;
END`,
  },
];
