CREATE TABLE `actions_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`updated_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actions_variables_repo_uq` ON `actions_variables` (`repository_id`,`kind`,`name`) WHERE repository_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `actions_variables_instance_uq` ON `actions_variables` (`kind`,`name`) WHERE repository_id IS NULL;