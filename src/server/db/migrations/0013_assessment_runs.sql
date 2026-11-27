CREATE TABLE `assessment_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'owner' NOT NULL,
	`edition_id` text NOT NULL,
	`kind` text NOT NULL,
	`hsk_band` text NOT NULL,
	`rubric_version` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`metadata_json` text NOT NULL,
	`results_json` text,
	FOREIGN KEY (`edition_id`) REFERENCES `curriculum_editions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assessment_runs_kind_check" CHECK("assessment_runs"."kind" IN ('band_test','checkpoint'))
);
--> statement-breakpoint
CREATE INDEX `assessment_runs_kind_idx` ON `assessment_runs` (`kind`,`started_at`);