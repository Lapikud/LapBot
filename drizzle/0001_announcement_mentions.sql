ALTER TABLE "announcements" ADD COLUMN "mention_role_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "mention_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "announcements" SET "mention_everyone" = true WHERE "mention_role_id" = "guild_id";--> statement-breakpoint
UPDATE "announcements" SET "mention_role_ids" = ARRAY["mention_role_id"] WHERE "mention_role_id" IS NOT NULL AND "mention_role_id" <> "guild_id";--> statement-breakpoint
ALTER TABLE "announcements" DROP COLUMN "mention_role_id";