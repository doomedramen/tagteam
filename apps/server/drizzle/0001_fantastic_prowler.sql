CREATE TABLE `applied_mutation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`timezone` text NOT NULL,
	`start_date` text NOT NULL,
	`rules` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`clocks` text NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_group_seq_idx` ON `task` (`group_id`,`seq`);--> statement-breakpoint
CREATE TABLE `task_event` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`occurrence_key` text,
	`ref_event_id` text,
	`at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_event_group_seq_idx` ON `task_event` (`group_id`,`seq`);--> statement-breakpoint
CREATE INDEX `task_event_task_idx` ON `task_event` (`task_id`);--> statement-breakpoint
ALTER TABLE `groups` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `membership` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profile` ADD `seq` integer DEFAULT 0 NOT NULL;