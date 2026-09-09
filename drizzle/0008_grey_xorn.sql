CREATE TABLE `setup_commits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`draft_version` integer NOT NULL,
	`configuration_snapshot` text,
	`configuration_schema_version` integer DEFAULT 1 NOT NULL,
	`configuration_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`preliminary_run_id` integer,
	`background_run_id` integer,
	`claim_status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`voided_at` integer,
	`voided_by_user_id` integer,
	`void_reason` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_commits_idempotency_unique` ON `setup_commits` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `setup_commits_ws_active_unique` ON `setup_commits` (`workspace_id`) WHERE claim_status = 'active';--> statement-breakpoint
CREATE INDEX `setup_commits_ws_idx` ON `setup_commits` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `setup_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`kind` text NOT NULL,
	`section` text,
	`status` text DEFAULT 'claimed' NOT NULL,
	`idempotency_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_usage_idempotency_unique` ON `setup_usage` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `setup_usage_report_unique` ON `setup_usage` (`workspace_id`) WHERE kind = 'report' and status in ('claimed', 'succeeded');--> statement-breakpoint
CREATE INDEX `setup_usage_user_idx` ON `setup_usage` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `onboarding_draft_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `provisioning_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_provisioning_key_unique` ON `workspaces` (`provisioning_key`) WHERE provisioning_key is not null;