CREATE TABLE `conversation_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`client_turn_id` text NOT NULL,
	`source_mode` text NOT NULL,
	`asr_text` text NOT NULL,
	`asr_uncertain` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ai_reply_zh` text,
	`ai_reply_json` text,
	`is_fallback` integer DEFAULT false NOT NULL,
	`model` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "conversation_turns_mode_check" CHECK("conversation_turns"."source_mode" IN ('speech','typed')),
	CONSTRAINT "conversation_turns_status_check" CHECK("conversation_turns"."status" IN ('pending','complete','failed')),
	CONSTRAINT "conversation_turns_complete_check" CHECK("conversation_turns"."status" <> 'complete' OR ("conversation_turns"."ai_reply_zh" IS NOT NULL AND "conversation_turns"."ai_reply_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_turns_client_idx` ON `conversation_turns` (`session_id`,`client_turn_id`);--> statement-breakpoint
CREATE INDEX `conversation_turns_session_idx` ON `conversation_turns` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`model` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`audio_seconds` real DEFAULT 0 NOT NULL,
	`tts_chars` integer DEFAULT 0 NOT NULL,
	`estimated_usd` real DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`recorded_at` text NOT NULL,
	CONSTRAINT "usage_events_status_check" CHECK("usage_events"."status" IN ('ok','invalid','error')),
	CONSTRAINT "usage_events_amounts_check" CHECK("usage_events"."tokens_in" >= 0 AND "usage_events"."tokens_out" >= 0 AND "usage_events"."estimated_usd" >= 0)
);
--> statement-breakpoint
CREATE INDEX `usage_events_recorded_idx` ON `usage_events` (`recorded_at`,`provider`);