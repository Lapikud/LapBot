ALTER TABLE "announcements" ADD COLUMN "mentions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "mentions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "mentions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "mentions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "announcements" SET "mentions" = jsonb_build_object('roles', to_jsonb("mention_role_ids")) WHERE cardinality("mention_role_ids") > 0;--> statement-breakpoint
UPDATE "events" SET "mentions" = jsonb_build_object('roles', jsonb_build_array("mention_role_id")) WHERE "mention_role_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "announcements" DROP COLUMN "mention_role_ids";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "mention_role_id";--> statement-breakpoint
WITH "guilds" AS (
  SELECT "guild_id" FROM "role_permissions"
  UNION SELECT "guild_id" FROM "announcements"
  UNION SELECT "guild_id" FROM "events"
  UNION SELECT "guild_id" FROM "polls"
  UNION SELECT "guild_id" FROM "reminders"
  UNION SELECT "guild_id" FROM "role_panels"
)
INSERT INTO "role_permissions" ("guild_id", "role_id", "subject_type", "permission", "granted_by")
SELECT "guilds"."guild_id", "guilds"."guild_id", 'role', "defaults"."permission", 'migration'
FROM "guilds"
CROSS JOIN (VALUES ('web:access'), ('event:create'), ('poll:create'), ('reminder:channel')) AS "defaults" ("permission")
WHERE NOT EXISTS (
  SELECT 1 FROM "role_permissions" "existing"
  WHERE "existing"."guild_id" = "guilds"."guild_id"
    AND "existing"."role_id" = "guilds"."guild_id"
    AND "existing"."subject_type" = 'role'
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "poll_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "form_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel_id" text,
	"message_id" text,
	"response_channel_id" text,
	"mentions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_responses_form_idx" ON "form_responses" USING btree ("form_id");
--> statement-breakpoint
UPDATE "events" SET "poll_id" = "movie_screenings"."poll_id" FROM "movie_screenings" WHERE "movie_screenings"."event_id" = "events"."id" AND "movie_screenings"."poll_id" IS NOT NULL AND "events"."poll_id" IS NULL AND EXISTS (SELECT 1 FROM "polls" WHERE "polls"."id" = "movie_screenings"."poll_id");
