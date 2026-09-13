DROP INDEX `mcp_connections_key_unique`;--> statement-breakpoint
DROP INDEX `mcp_connections_grant_unique`;--> statement-breakpoint
ALTER TABLE `mcp_connections` ADD `all_workspaces` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `mcp_connections_key_idx` ON `mcp_connections` (`connection_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_connections_grant_unique` ON `mcp_connections` (`grant_id`,`workspace_id`);