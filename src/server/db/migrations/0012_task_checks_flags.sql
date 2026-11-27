CREATE TABLE `item_flags` (
	`curriculum_item_id` text PRIMARY KEY NOT NULL,
	`note` text,
	`flagged_at` text NOT NULL,
	FOREIGN KEY (`curriculum_item_id`) REFERENCES `curriculum_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_checks` (
	`session_id` text PRIMARY KEY NOT NULL,
	`task_item_id` text NOT NULL,
	`topic_item_id` text,
	`local_study_date` text NOT NULL,
	`criteria_json` text NOT NULL,
	`passed` integer NOT NULL,
	`scorer_model` text NOT NULL,
	`scorer_version` text NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_item_id`) REFERENCES `curriculum_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_checks_task_idx` ON `task_checks` (`task_item_id`);