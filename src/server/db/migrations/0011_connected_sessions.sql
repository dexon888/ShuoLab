CREATE TABLE `session_items` (
	`session_id` text NOT NULL,
	`curriculum_item_id` text NOT NULL,
	`item_type` text NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`session_id`, `curriculum_item_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`curriculum_item_id`) REFERENCES `curriculum_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_items_type_check" CHECK("session_items"."item_type" IN ('grammar','character','topic','task')),
	CONSTRAINT "session_items_role_check" CHECK("session_items"."role" IN ('new','recycled','target'))
);
--> statement-breakpoint
CREATE INDEX `session_items_item_idx` ON `session_items` (`curriculum_item_id`);--> statement-breakpoint
CREATE TABLE `session_materials` (
	`session_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`source` text,
	`model` text,
	`stand_in` integer DEFAULT 0 NOT NULL,
	`covers_targets` integer DEFAULT 1 NOT NULL,
	`content_json` text,
	`reading_answers_json` text,
	`reading_correct` integer,
	`reading_answered_at` text,
	`reading_revealed_at` text,
	`practice_json` text,
	`writing_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
