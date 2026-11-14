CREATE TABLE `colloquial_expressions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`slug` text NOT NULL,
	`term` text NOT NULL,
	`pinyin` text,
	`meaning_en` text NOT NULL,
	`literal_en` text,
	`category` text,
	`register` text NOT NULL,
	`channel` text NOT NULL,
	`region` text,
	`currency_status` text DEFAULT 'unknown' NOT NULL,
	`in_use_since` text,
	`last_verified_at` text,
	`source_url` text NOT NULL,
	`license` text NOT NULL,
	`attribution` text NOT NULL,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`dataset_version` text,
	`file_sha256` text,
	`imported_at` text NOT NULL,
	CONSTRAINT "colloquial_expressions_register_check" CHECK("colloquial_expressions"."register" IN ('formal','neutral','casual','very_informal')),
	CONSTRAINT "colloquial_expressions_channel_check" CHECK("colloquial_expressions"."channel" IN ('spoken','typed','both')),
	CONSTRAINT "colloquial_expressions_currency_status_check" CHECK("colloquial_expressions"."currency_status" IN ('hot','steady','fading','unknown')),
	CONSTRAINT "colloquial_expressions_verification_status_check" CHECK("colloquial_expressions"."verification_status" IN ('verified','unverified'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `colloquial_expressions_source_slug_uq` ON `colloquial_expressions` (`source_key`,`slug`);