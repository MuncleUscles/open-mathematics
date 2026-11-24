CREATE TABLE `forecasts` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` text NOT NULL,
	`participant` text NOT NULL,
	`revision` integer NOT NULL,
	`nonce` text NOT NULL,
	`accepted_at` text NOT NULL,
	`payload` text NOT NULL,
	`public_key` text NOT NULL,
	`signature` text NOT NULL,
	`receipt` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_revision` ON `forecasts` (`question_id`,`participant`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_nonce` ON `forecasts` (`participant`,`nonce`);--> statement-breakpoint
CREATE UNIQUE INDEX `forecast_receipt` ON `forecasts` (`receipt`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`definition` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `bucket`)
);
--> statement-breakpoint
CREATE TABLE `resolutions` (
	`question_id` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
