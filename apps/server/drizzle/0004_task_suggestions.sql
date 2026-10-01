CREATE TABLE `suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`start_date` text NOT NULL,
	`due_time` text,
	`rule` text,
	`status` text NOT NULL,
	`task_id` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`seq` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `suggestion_group_seq_idx` ON `suggestion` (`group_id`,`seq`);--> statement-breakpoint
CREATE INDEX `suggestion_pair_idx` ON `suggestion` (`group_id`,`from_user_id`,`to_user_id`,`status`);--> statement-breakpoint
ALTER TABLE `task` ADD `suggested_by` text REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE TABLE `__new_notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`suggestion_id` text,
	`user_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestion`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notification_log`(`id`, `task_id`, `user_id`, `occurrence_key`, `kind`, `title`, `body`, `url`, `created_at`, `sent_at`) SELECT `id`, `task_id`, `user_id`, `occurrence_key`, `kind`, `title`, `body`, `url`, `created_at`, `sent_at` FROM `notification_log`;--> statement-breakpoint
CREATE TABLE `__notification_delivery_backup` AS SELECT * FROM `notification_delivery`;--> statement-breakpoint
DROP TABLE `notification_delivery`;--> statement-breakpoint
DROP TABLE `notification_log`;--> statement-breakpoint
ALTER TABLE `__new_notification_log` RENAME TO `notification_log`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_dedupe_unique` ON `notification_log` (`task_id`,`occurrence_key`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_suggestion_unique` ON `notification_log` (`suggestion_id`,`kind`);--> statement-breakpoint
CREATE INDEX `notification_log_pending_idx` ON `notification_log` (`sent_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	FOREIGN KEY (`notification_id`) REFERENCES `notification_log`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `notification_delivery` SELECT * FROM `__notification_delivery_backup`;--> statement-breakpoint
DROP TABLE `__notification_delivery_backup`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_notification_endpoint_unique` ON `notification_delivery` (`notification_id`,`endpoint`);--> statement-breakpoint
CREATE INDEX `notification_delivery_pending_idx` ON `notification_delivery` (`status`,`next_attempt_at`);
