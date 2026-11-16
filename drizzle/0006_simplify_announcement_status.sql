ALTER TABLE "announcements" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "announcements" SET "status" = 'draft' WHERE "status" IN ('publishing', 'failed');--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "status" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."announcement_status";--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'scheduled', 'published', 'cancelled');--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."announcement_status";--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "status" SET DATA TYPE "public"."announcement_status" USING "status"::"public"."announcement_status";