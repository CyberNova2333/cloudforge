CREATE TABLE `notification_subscriptions` (
	`user_id` text NOT NULL,
	`thread` text NOT NULL,
	`repository_id` text NOT NULL,
	`issue_id` text,
	`pull_request_id` text,
	`subscribed` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `thread`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_subscriptions_thread_idx` ON `notification_subscriptions` (`thread`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`thread` text NOT NULL,
	`issue_id` text,
	`pull_request_id` text,
	`reason` text NOT NULL,
	`event` text NOT NULL,
	`actor_id` text,
	`excerpt` text,
	`unread` integer DEFAULT true NOT NULL,
	`email_pending_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_thread_uq` ON `notifications` (`user_id`,`thread`);--> statement-breakpoint
CREATE INDEX `notifications_user_inbox_idx` ON `notifications` (`user_id`,`unread`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notifications_email_idx` ON `notifications` (`email_pending_at`);--> statement-breakpoint
CREATE INDEX `notifications_updated_idx` ON `notifications` (`updated_at`);--> statement-breakpoint
CREATE TABLE `repository_watches` (
	`user_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`level` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repository_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repository_watches_repo_idx` ON `repository_watches` (`repository_id`,`level`);