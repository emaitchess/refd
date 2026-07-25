CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`panels` text,
	`panel_data` text,
	`links` text,
	`steps` text,
	`duration_ms` integer,
	`proposal` text,
	`sources` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_messages_chat_idx` ON `chat_messages` (`chat_id`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chats_ws_idx` ON `chats` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `citations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result_id` integer NOT NULL,
	`url` text NOT NULL,
	`host` text,
	`registrable_domain` text,
	`entity_id` integer,
	`origin` text,
	`rank` integer,
	FOREIGN KEY (`result_id`) REFERENCES `results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `citations_result_idx` ON `citations` (`result_id`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`name` text NOT NULL,
	`domains` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`is_brand` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_ws_name_unique` ON `entities` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `entities_ws_idx` ON `entities` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `entity_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result_id` integer NOT NULL,
	`entity_id` integer NOT NULL,
	`mentioned` integer DEFAULT false NOT NULL,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`first_offset` integer,
	`spans` text,
	`cited` integer DEFAULT false NOT NULL,
	`cited_count` integer DEFAULT 0 NOT NULL,
	`position` integer,
	`prominence` text,
	`scoring_version` integer DEFAULT 0 NOT NULL,
	`sentiment` text,
	FOREIGN KEY (`result_id`) REFERENCES `results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_scores_identity_unique` ON `entity_scores` (`result_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `entity_scores_entity_idx` ON `entity_scores` (`entity_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`text` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompts_ws_text_unique` ON `prompts` (`workspace_id`,`text`);--> statement-breakpoint
CREATE INDEX `prompts_ws_idx` ON `prompts` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`prompt_id` integer NOT NULL,
	`surface` text NOT NULL,
	`sample` integer NOT NULL,
	`provider` text NOT NULL,
	`ok` integer DEFAULT false NOT NULL,
	`answer_present` integer DEFAULT true NOT NULL,
	`r2_key` text,
	`total_urls` integer DEFAULT 0 NOT NULL,
	`error` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `results_identity_unique` ON `results` (`run_id`,`prompt_id`,`surface`,`sample`);--> statement-breakpoint
CREATE INDEX `results_run_idx` ON `results` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`key` text NOT NULL,
	`date` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`ok_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`entity_snapshot` text,
	`entity_set_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_key_unique` ON `runs` (`key`);--> statement-breakpoint
CREATE INDEX `runs_date_idx` ON `runs` (`date`);--> statement-breakpoint
CREATE INDEX `runs_ws_idx` ON `runs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`provider` text NOT NULL,
	`surface` text NOT NULL,
	`sample` integer DEFAULT 1 NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'triggered' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	`polls` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_run_surface_unique` ON `snapshots` (`run_id`,`provider`,`surface`,`sample`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`token_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` integer NOT NULL,
	`onboarding_completed` integer DEFAULT false NOT NULL,
	`profile` text,
	`surfaces` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
