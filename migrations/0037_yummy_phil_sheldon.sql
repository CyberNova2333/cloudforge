DROP INDEX `landing_intents_pull_uq`;--> statement-breakpoint
CREATE INDEX `landing_intents_pull_idx` ON `landing_intents` (`pull_request_id`);