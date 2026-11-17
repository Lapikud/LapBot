ALTER TABLE "role_permissions" ADD COLUMN "subject_type" text DEFAULT 'role' NOT NULL;
--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_guild_id_role_id_permission_pk";
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_subject_type_check" CHECK ("subject_type" IN ('role', 'user'));
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD PRIMARY KEY ("guild_id", "role_id", "subject_type", "permission");
