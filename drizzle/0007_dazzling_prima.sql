CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`connection_key` text NOT NULL,
	`name` text NOT NULL,
	`workspace_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_key_unique` ON `api_tokens` (`connection_key`);--> statement-breakpoint
CREATE INDEX `api_tokens_ws_idx` ON `api_tokens` (`workspace_id`);