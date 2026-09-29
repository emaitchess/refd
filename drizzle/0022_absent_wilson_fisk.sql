ALTER TABLE `prompts` ADD `funnel_stage` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `question_type` text;--> statement-breakpoint
CREATE INDEX `prompts_ws_stage_idx` ON `prompts` (`workspace_id`,`funnel_stage`);--> statement-breakpoint
CREATE INDEX `prompts_ws_type_idx` ON `prompts` (`workspace_id`,`question_type`);