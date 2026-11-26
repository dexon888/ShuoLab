CREATE TABLE `mastery_states` (
	`owner_id` text DEFAULT 'owner' NOT NULL,
	`curriculum_item_id` text NOT NULL,
	`skill` text NOT NULL,
	`state` text NOT NULL,
	`first_seen_at` text,
	`last_attempt_at` text,
	`last_success_at` text,
	`success_days` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `curriculum_item_id`, `skill`),
	FOREIGN KEY (`curriculum_item_id`) REFERENCES `curriculum_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mastery_states_state_check" CHECK("mastery_states"."state" IN ('unseen','introduced','practiced','developing','mastered'))
);
--> statement-breakpoint
CREATE TABLE `practice_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`curriculum_item_id` text,
	`colloquial_id` text,
	`skill` text NOT NULL,
	`assessment_type` text NOT NULL,
	`prompt_id` text NOT NULL,
	`user_response` text,
	`score` real,
	`score_source` text NOT NULL,
	`is_qualifying_recall` integer NOT NULL,
	`success` integer NOT NULL,
	`review_event_id` text,
	`attempted_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`curriculum_item_id`) REFERENCES `curriculum_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "practice_attempts_skill_check" CHECK("practice_attempts"."skill" IN ('listening','speaking','reading','writing')),
	CONSTRAINT "practice_attempts_source_check" CHECK("practice_attempts"."score_source" IN ('self','rubric')),
	CONSTRAINT "practice_attempts_subject_check" CHECK(("practice_attempts"."curriculum_item_id" IS NULL) <> ("practice_attempts"."colloquial_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `practice_attempts_item_skill_idx` ON `practice_attempts` (`curriculum_item_id`,`skill`,`attempted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_attempts_review_event_idx` ON `practice_attempts` (`review_event_id`);--> statement-breakpoint
CREATE TABLE `review_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'owner' NOT NULL,
	`curriculum_item_id` text NOT NULL,
	`skill` text NOT NULL,
	`template` text NOT NULL,
	`fsrs_state_json` text NOT NULL,
	`due_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`curriculum_item_id`) REFERENCES `curriculum_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_cards_item_template_idx` ON `review_cards` (`curriculum_item_id`,`template`);--> statement-breakpoint
CREATE INDEX `review_cards_due_idx` ON `review_cards` (`owner_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`review_card_id` text NOT NULL,
	`client_event_id` text NOT NULL,
	`rating` text NOT NULL,
	`elapsed_days` real NOT NULL,
	`state_before_json` text NOT NULL,
	`state_after_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_card_id`) REFERENCES `review_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_events_rating_check" CHECK("review_events"."rating" IN ('again','hard','good','easy'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_events_client_event_idx` ON `review_events` (`client_event_id`);--> statement-breakpoint
CREATE INDEX `review_events_card_idx` ON `review_events` (`review_card_id`,`created_at`);