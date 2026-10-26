CREATE TABLE `repository_deploy_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`created_by_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text DEFAULT 'read' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_deploy_tokens_token_hash_unique` ON `repository_deploy_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `repository_deploy_tokens_repo_idx` ON `repository_deploy_tokens` (`repository_id`);