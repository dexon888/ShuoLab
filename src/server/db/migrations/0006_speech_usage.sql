ALTER TABLE `usage_events` ADD `client_event_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `usage_events_client_event_idx` ON `usage_events` (`client_event_id`);