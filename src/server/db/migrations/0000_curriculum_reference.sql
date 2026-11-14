CREATE TABLE `curriculum_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`publisher` text NOT NULL,
	`edition_date` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `curriculum_items` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`item_type` text NOT NULL,
	`hsk_band` text NOT NULL,
	`hanzi` text NOT NULL,
	`entry_raw` text,
	`pinyin` text,
	`part_of_speech` text,
	`homograph` text,
	`level_label` text,
	`source_pdf_page` integer,
	`definition` text,
	`definition_provenance` text,
	`metadata_json` text,
	FOREIGN KEY (`edition_id`) REFERENCES `curriculum_editions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "curriculum_items_item_type_check" CHECK("curriculum_items"."item_type" IN ('vocab','grammar','character','topic','task')),
	CONSTRAINT "curriculum_items_hsk_band_check" CHECK("curriculum_items"."hsk_band" IN ('1','2','3','4','5','6','7-9')),
	CONSTRAINT "curriculum_items_source_id_check" CHECK("curriculum_items"."source_id" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curriculum_items_edition_type_source_uq` ON `curriculum_items` (`edition_id`,`item_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `curriculum_items_edition_type_band_idx` ON `curriculum_items` (`edition_id`,`item_type`,`hsk_band`);--> statement-breakpoint
CREATE TABLE `source_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text NOT NULL,
	`dataset_kind` text NOT NULL,
	`source_url` text NOT NULL,
	`commit_sha` text,
	`sha256` text NOT NULL,
	`rights_note` text NOT NULL,
	`field_mapping_version` text NOT NULL,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`record_count` integer NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`edition_id`) REFERENCES `curriculum_editions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_manifests_verification_status_check" CHECK("source_manifests"."verification_status" IN ('verified','unverified'))
);
--> statement-breakpoint
CREATE INDEX `source_manifests_edition_kind_idx` ON `source_manifests` (`edition_id`,`dataset_kind`);