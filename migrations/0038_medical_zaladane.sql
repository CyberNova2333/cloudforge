CREATE TABLE `pull_close_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_request_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`head_ref` text NOT NULL,
	`target` text NOT NULL,
	`created_at` integer NOT NULL,
	`attempted_at` integer,
	`finished_at` integer,
	`completed` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pull_close_intents_pull_uq` ON `pull_close_intents` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `pull_close_intents_pending_idx` ON `pull_close_intents` (`finished_at`,`attempted_at`);