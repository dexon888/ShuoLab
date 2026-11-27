CREATE TABLE `onramp_results` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL,
	`passed` integer NOT NULL,
	`answers_json` text NOT NULL,
	`answered_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `onramp_results_unit_idx` ON `onramp_results` (`unit_id`,`answered_at`);