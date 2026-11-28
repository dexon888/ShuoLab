CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`hsk_band` text NOT NULL,
	`title_zh` text NOT NULL,
	`title_en` text NOT NULL,
	`episode` integer NOT NULL,
	`content_json` text NOT NULL,
	`coverage_known` integer NOT NULL,
	`coverage_total` integer NOT NULL,
	`model` text NOT NULL,
	`stand_in` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`answers_json` text,
	`correct` integer,
	`answered_at` text,
	`revealed_at` text,
	`finished_at` text,
	`minutes` real DEFAULT 0 NOT NULL,
	CONSTRAINT "stories_kind_check" CHECK("stories"."kind" IN ('story','dialogue'))
);
--> statement-breakpoint
CREATE INDEX `stories_created_idx` ON `stories` (`created_at`);