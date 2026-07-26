ALTER TABLE `snapshots` ADD `prompt_snapshot` text;--> statement-breakpoint
CREATE INDEX `snapshots_external_id_idx` ON `snapshots` (`external_id`);