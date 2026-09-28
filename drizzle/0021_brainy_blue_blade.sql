CREATE TABLE `attributes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attributes_ws_label_unique` ON `attributes` (`workspace_id`,`label`);--> statement-breakpoint
CREATE INDEX `attributes_ws_idx` ON `attributes` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `prompts` ADD `attribute_id` integer REFERENCES attributes(id);--> statement-breakpoint
CREATE INDEX `prompts_ws_attribute_idx` ON `prompts` (`workspace_id`,`attribute_id`);