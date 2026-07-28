ALTER TABLE `mcp_connections` ADD `connection_key` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_connections_key_unique` ON `mcp_connections` (`connection_key`);