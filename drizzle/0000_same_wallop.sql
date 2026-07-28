CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`style_id` integer NOT NULL,
	`version` integer NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`style_id`) REFERENCES `styles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`action` text NOT NULL,
	`before_value` text,
	`after_value` text,
	`actor` text NOT NULL,
	`idempotency_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_logs_idempotency_idx` ON `audit_logs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `change_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`style_id` integer NOT NULL,
	`from_version` integer NOT NULL,
	`to_version` integer NOT NULL,
	`reason` text NOT NULL,
	`content` text NOT NULL,
	`applicant` text NOT NULL,
	`status` text DEFAULT '待主管处理' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`style_id`) REFERENCES `styles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`channel` text DEFAULT '系统内' NOT NULL,
	`status` text DEFAULT '待处理' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `process_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`style_id` integer NOT NULL,
	`process` text NOT NULL,
	`sequence` integer NOT NULL,
	`assignee` text NOT NULL,
	`status` text NOT NULL,
	`planned_start` text,
	`planned_end` text,
	`actual_start` text,
	`actual_end` text,
	`pause_reason` text,
	`exception_note` text,
	`version` integer DEFAULT 1 NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`style_id`) REFERENCES `styles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sample_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`customer` text NOT NULL,
	`merchandiser` text NOT NULL,
	`due_date` text NOT NULL,
	`priority` text DEFAULT '普通' NOT NULL,
	`sample_type` text DEFAULT '开发样' NOT NULL,
	`status` text DEFAULT '待审单' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sample_orders_order_no_idx` ON `sample_orders` (`order_no`);--> statement-breakpoint
CREATE TABLE `styles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`style_no` text NOT NULL,
	`color` text NOT NULL,
	`size` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`main_image` text NOT NULL,
	`status` text DEFAULT '待审单' NOT NULL,
	`current_process` text DEFAULT '审单' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `sample_orders`(`id`) ON UPDATE no action ON DELETE no action
);
