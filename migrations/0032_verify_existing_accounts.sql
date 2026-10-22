-- Self sign-up can require a verified email before sign-in (users.email_verified). Every account made before
-- self sign-up existed came from setup or an invitation, which are trusted: mark those people verified. Agents
-- (rows in `agents`) can't sign in at all and stay as they are.
UPDATE `users` SET `email_verified` = 1 WHERE `id` NOT IN (SELECT `user_id` FROM `agents`);
