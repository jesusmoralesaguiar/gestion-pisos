CREATE TABLE IF NOT EXISTS `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'abierta' NOT NULL,
	`photo_uri` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`cadastral_ref` text DEFAULT '' NOT NULL,
	`regime` text DEFAULT 'residencial' NOT NULL,
	`tax_region` text DEFAULT 'canarias' NOT NULL,
	`igic_regime` text DEFAULT 'repep' NOT NULL,
	`monthly_rent` real DEFAULT 0 NOT NULL,
	`payment_day` integer DEFAULT 5 NOT NULL,
	`tenant_name` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer,
	`title` text NOT NULL,
	`category` text DEFAULT 'otro' NOT NULL,
	`due_date` text NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reminders_due_date` ON `reminders` (`due_date`,`completed`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` integer NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`amount` real NOT NULL,
	`base_amount` real DEFAULT 0 NOT NULL,
	`vat_amount` real DEFAULT 0 NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'completado' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`attachment_uri` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_property_date` ON `transactions` (`property_id`,`date`);