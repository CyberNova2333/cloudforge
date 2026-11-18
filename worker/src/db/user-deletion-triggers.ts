// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Modifications by CyberNova are licensed under AGPL-3.0-only with Additional Terms (see ADDITIONAL_TERMS.zh-CN.md; ref: ADDITIONAL_TERMS.en.md).
export const USER_DELETION_TRIGGERS = [
  {
    name: 'cloudforge_user_repository_delete_v1',
    // User deletion cannot bypass repository shutdown, deletion outbox, or storage cleanup.
    sql: `CREATE TRIGGER cloudforge_user_repository_delete_v1 BEFORE DELETE ON users FOR EACH ROW
    WHEN EXISTS (SELECT 1 FROM repositories WHERE owner_id=OLD.id)
    BEGIN SELECT RAISE(ABORT, 'User still owns repositories'); END`,
  },
];
