CREATE TABLE `commit_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`sha` text NOT NULL,
	`context` text NOT NULL,
	`state` text NOT NULL,
	`target_url` text,
	`description` text,
	`creator_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `commit_statuses_repo_sha_idx` ON `commit_statuses` (`repository_id`,`sha`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`event` text NOT NULL,
	`action` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`claimed_at` integer,
	`response_status` integer,
	`response_body` text,
	`error` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_due_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_hook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_created_idx` ON `webhook_deliveries` (`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`events` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by_id` text,
	`last_status` integer,
	`last_delivered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhooks_repo_idx` ON `webhooks` (`repository_id`);