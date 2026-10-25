CREATE TABLE `repository_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifacts_name` text NOT NULL,
	`full_name` text NOT NULL,
	`completed` text DEFAULT '{}' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `repository_deletions_pending_idx` ON `repository_deletions` (`finished_at`);