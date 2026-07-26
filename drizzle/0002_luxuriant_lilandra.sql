DROP INDEX `snapshots_run_surface_unique`;--> statement-breakpoint
ALTER TABLE `snapshots` ADD `chunk` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `snapshots` ADD `prompt_ids` text;--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_run_surface_unique` ON `snapshots` (`run_id`,`provider`,`surface`,`sample`,`chunk`);