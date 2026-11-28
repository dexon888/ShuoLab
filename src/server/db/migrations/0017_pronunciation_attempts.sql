CREATE TABLE `pronunciation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`reference_text` text NOT NULL,
	`accuracy` real NOT NULL,
	`fluency` real NOT NULL,
	`completeness` real NOT NULL,
	`pronunciation` real NOT NULL,
	`words_json` text NOT NULL,
	`audio_seconds` real NOT NULL,
	`attempted_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pronunciation_attempts_at_idx` ON `pronunciation_attempts` (`attempted_at`);