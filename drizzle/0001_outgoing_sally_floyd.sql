ALTER TABLE `workspaces` ADD `monitoring_tier` text DEFAULT 'snapshot_only' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `monitoring_ends_at` integer;