CREATE TABLE `listening_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text,
	`model` text,
	`stand_in` integer DEFAULT false NOT NULL,
	`content_json` text,
	`created_at` text NOT NULL,
	`played_at` text,
	`revealed_at` text,
	`answered_at` text,
	`answers_json` text,
	`correct_count` integer,
	`question_count` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "listening_exercises_status_check" CHECK("listening_exercises"."status" IN ('pending','ready','failed')),
	CONSTRAINT "listening_exercises_ready_check" CHECK("listening_exercises"."status" <> 'ready' OR ("listening_exercises"."content_json" IS NOT NULL AND "listening_exercises"."source" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listening_exercises_session_idx` ON `listening_exercises` (`session_id`);