ALTER TABLE `prompts` ADD `kind` text;--> statement-breakpoint
CREATE INDEX `prompts_ws_kind_idx` ON `prompts` (`workspace_id`,`kind`);