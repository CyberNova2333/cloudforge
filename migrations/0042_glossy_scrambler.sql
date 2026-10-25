CREATE TABLE `push_events` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`actor_id` text,
	`commands` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `push_events_pending_idx` ON `push_events` (`completed_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `push_events_repository_idx` ON `push_events` (`repository_id`);