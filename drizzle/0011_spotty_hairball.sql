CREATE TABLE `chat_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`chat_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`question_id` integer,
	`deadline_at` integer NOT NULL,
	`last_event_seq` integer DEFAULT 0 NOT NULL,
	`error` text,
	`accepted_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_exchanges_request_unique` ON `chat_exchanges` (`workspace_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_exchanges_active_chat_unique` ON `chat_exchanges` (`chat_id`) WHERE status in ('accepted', 'running');--> statement-breakpoint
CREATE INDEX `chat_exchanges_chat_idx` ON `chat_exchanges` (`chat_id`,`accepted_at`);--> statement-breakpoint
CREATE INDEX `chat_exchanges_workspace_idx` ON `chat_exchanges` (`workspace_id`,`accepted_at`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `exchange_id` text REFERENCES chat_exchanges(id);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_messages_exchange_role_unique` ON `chat_messages` (`exchange_id`,`role`);