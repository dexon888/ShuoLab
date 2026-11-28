PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assessment_runs` (
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
	CONSTRAINT "assessment_runs_kind_check" CHECK("__new_assessment_runs"."kind" IN ('band_test','checkpoint','placement'))
);
--> statement-breakpoint
INSERT INTO `__new_assessment_runs`("id", "owner_id", "edition_id", "kind", "hsk_band", "rubric_version", "started_at", "finished_at", "metadata_json", "results_json") SELECT "id", "owner_id", "edition_id", "kind", "hsk_band", "rubric_version", "started_at", "finished_at", "metadata_json", "results_json" FROM `assessment_runs`;--> statement-breakpoint
DROP TABLE `assessment_runs`;--> statement-breakpoint
ALTER TABLE `__new_assessment_runs` RENAME TO `assessment_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `assessment_runs_kind_idx` ON `assessment_runs` (`kind`,`started_at`);