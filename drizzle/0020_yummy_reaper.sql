CREATE TABLE `prompt_set_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` integer NOT NULL,
	`prompt_set_hash` text NOT NULL,
	`prompt_ids` text NOT NULL,
	`surface_ids` text NOT NULL,
	`change_reason` text,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_set_versions_ws_hash_unique` ON `prompt_set_versions` (`workspace_id`,`prompt_set_hash`);--> statement-breakpoint
CREATE INDEX `prompt_set_versions_ws_idx` ON `prompt_set_versions` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `prompt_set_version_id` integer REFERENCES prompt_set_versions(id);