CREATE TABLE `actions_secret_repositories` (
	`secret_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`secret_id`, `repository_id`),
	FOREIGN KEY (`secret_id`) REFERENCES `actions_variables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `actions_secret_repositories_repo_idx` ON `actions_secret_repositories` (`repository_id`);