CREATE TABLE IF NOT EXISTS `logs` (
	`id` integer PRIMARY KEY NOT NULL,
	`time` integer NOT NULL,
	`level` integer NOT NULL,
	`message` text NOT NULL,
	`source` text NOT NULL,
	`details` text NOT NULL
);
