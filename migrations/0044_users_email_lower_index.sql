-- Lookups compare addresses without case (`lower(email) = ?`: email-claims.ts, invitations, alternate emails), which
-- the unique index on `email` can't serve, so each one read the whole table. users is better-auth's generated schema,
-- so this index is declared here, not in auth.schema.ts.
CREATE INDEX IF NOT EXISTS `users_email_lower_idx` ON `users` (lower(`email`));
