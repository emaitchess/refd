CREATE TABLE `raw_cleanup_tasks` (
	`key` text PRIMARY KEY NOT NULL,
	`available_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
