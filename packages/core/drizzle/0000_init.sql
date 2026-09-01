CREATE TABLE `dataset_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`number` integer NOT NULL,
	`label` text,
	`notes` text,
	`item_count` integer NOT NULL,
	`snapshot_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataset_versions_dataset_number_uq` ON `dataset_versions` (`dataset_id`,`number`);--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`input_schema` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`input` text NOT NULL,
	`expected` text,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_revisions_item_hash_uq` ON `item_revisions` (`item_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `item_revisions_dataset_hash_idx` ON `item_revisions` (`dataset_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`head_revision_id` text,
	`position` integer NOT NULL,
	`deleted_at` text,
	`expected_source` text,
	`expected_model` text,
	`expected_rationale` text,
	`expected_reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `items_dataset_position_idx` ON `items` (`dataset_id`,`position`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`dataset_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`progress` text DEFAULT '{}' NOT NULL,
	`result` text,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `run_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`item_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`rendered_messages` text,
	`output` text,
	`raw_response` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`latency_ms` integer,
	`error` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `item_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_items_run_item_uq` ON `run_items` (`run_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `run_items_run_status_idx` ON `run_items` (`run_id`,`status`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`version_id` text NOT NULL,
	`name` text,
	`task_config_id` text,
	`config_snapshot` text NOT NULL,
	`scorers` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`concurrency` integer DEFAULT 4 NOT NULL,
	`triggered_by` text DEFAULT 'api' NOT NULL,
	`total_items` integer DEFAULT 0 NOT NULL,
	`completed_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`max_cost_usd` real,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `dataset_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_config_id`) REFERENCES `task_configs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `runs_dataset_idx` ON `runs` (`dataset_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `scorer_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scores` (
	`id` text PRIMARY KEY NOT NULL,
	`run_item_id` text NOT NULL,
	`scorer_key` text NOT NULL,
	`scorer_type` text NOT NULL,
	`scorer_config` text DEFAULT '{}' NOT NULL,
	`score` real,
	`passed` integer,
	`rationale` text,
	`details` text,
	`judge_model` text,
	`judge_tokens` integer,
	`judge_cost_usd` real,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_item_id`) REFERENCES `run_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scores_run_item_scorer_uq` ON `scores` (`run_item_id`,`scorer_key`);--> statement-breakpoint
CREATE TABLE `task_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`dataset_id` text,
	`model` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`system_prompt` text,
	`user_template` text,
	`output_schema` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `version_items` (
	`version_id` text NOT NULL,
	`item_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`position` integer NOT NULL,
	`expected_reviewed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`version_id`, `item_id`),
	FOREIGN KEY (`version_id`) REFERENCES `dataset_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `item_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
