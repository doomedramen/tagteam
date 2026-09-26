ALTER TABLE `notification_settings` ADD `reminders_enabled_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_settings` ADD `nudges_enabled_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `notification_settings`
SET `reminders_enabled_at` = `updated_at`, `nudges_enabled_at` = `updated_at`;
