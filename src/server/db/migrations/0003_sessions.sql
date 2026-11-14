CREATE TABLE `session_targets` (
	`session_id` text NOT NULL,
	`curriculum_item_id` text NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`session_id`, `curriculum_item_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`curriculum_item_id`) REFERENCES `curriculum_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_targets_role_check" CHECK("session_targets"."role" IN ('active','review','stretch'))
);
--> statement-breakpoint
CREATE INDEX `session_targets_item_idx` ON `session_targets` (`curriculum_item_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'owner' NOT NULL,
	`kind` text NOT NULL,
	`edition_id` text,
	`local_study_date` text NOT NULL,
	`duration_target_min` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`plan_json` text NOT NULL,
	`actual_seconds` integer DEFAULT 0 NOT NULL,
	`model` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	FOREIGN KEY (`edition_id`) REFERENCES `curriculum_editions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sessions_owner_check" CHECK("sessions"."owner_id" = 'owner'),
	CONSTRAINT "sessions_kind_check" CHECK("sessions"."kind" IN ('hsk','free_chat')),
	CONSTRAINT "sessions_status_check" CHECK("sessions"."status" IN ('planned','active','paused','complete','abandoned')),
	CONSTRAINT "sessions_duration_check" CHECK("sessions"."duration_target_min" IN (15,20,25,30)),
	CONSTRAINT "sessions_kind_edition_check" CHECK(("sessions"."kind" = 'hsk' AND "sessions"."edition_id" IS NOT NULL) OR ("sessions"."kind" = 'free_chat' AND "sessions"."edition_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `sessions_date_idx` ON `sessions` (`local_study_date`);--> statement-breakpoint
CREATE INDEX `sessions_created_idx` ON `sessions` (`created_at`);