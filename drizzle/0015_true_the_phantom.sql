ALTER TABLE `raw_cleanup_tasks` ADD `token` text;--> statement-breakpoint
ALTER TABLE `raw_cleanup_tasks` ADD `lease_expires_at` integer;