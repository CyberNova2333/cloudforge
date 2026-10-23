CREATE TABLE `landing_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_request_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`target` text NOT NULL,
	`base_sha` text NOT NULL,
	`head_sha` text NOT NULL,
	`land_head_sha` text NOT NULL,
	`pull_ref_before` text NOT NULL,
	`landed_commits` integer NOT NULL,
	`actor_id` text,
	`automatic` integer NOT NULL,
	`created_at` integer NOT NULL,
	`recorded_at` integer,
	`finished_at` integer,
	`attempted_at` integer,
	`completed` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landing_intents_pull_uq` ON `landing_intents` (`pull_request_id`);--> statement-breakpoint
CREATE INDEX `landing_intents_pending_idx` ON `landing_intents` (`finished_at`,`attempted_at`);--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `event_data` text;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `trigger_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_repo_trigger_uq` ON `workflow_runs` (`repository_id`,`trigger_key`);