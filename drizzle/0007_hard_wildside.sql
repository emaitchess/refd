ALTER TABLE `runs` ADD `dispatch_plan` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_state` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_cursor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_last_error` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_started_at` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_finished_at` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_lease_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `dispatch_lease_until` integer;--> statement-breakpoint
CREATE INDEX `runs_dispatch_idx` ON `runs` (`dispatch_state`,`dispatch_next_attempt_at`,`dispatch_lease_until`);