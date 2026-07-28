CREATE TABLE `mcp_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`grant_id` text NOT NULL,
	`workspace_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_connections_grant_unique` ON `mcp_connections` (`grant_id`);--> statement-breakpoint
CREATE INDEX `mcp_connections_ws_idx` ON `mcp_connections` (`workspace_id`);