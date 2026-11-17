CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'scheduled', 'published', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."birthday_visibility" AS ENUM('public', 'announce', 'private');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('going', 'maybe', 'not_going');--> statement-breakpoint
CREATE TYPE "public"."poll_result_visibility" AS ENUM('live', 'closed');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reminder_recurrence" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('active', 'done', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."role_panel_kind" AS ENUM('reaction', 'select');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"author_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"mention_role_ids" text[] DEFAULT '{}' NOT NULL,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"message_ids" text[] DEFAULT '{}' NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birthday_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"role_id" text,
	"hour" smallint DEFAULT 9 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birthdays" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"month" smallint NOT NULL,
	"day" smallint NOT NULL,
	"visibility" "birthday_visibility" DEFAULT 'public' NOT NULL,
	"last_announced_year" integer,
	CONSTRAINT "birthdays_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"event_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"status" "rsvp_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"location" text,
	"organizer_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"capacity" integer,
	"mention_role_id" text,
	"reminder_minutes" integer[] DEFAULT '{}' NOT NULL,
	"icons" boolean DEFAULT true NOT NULL,
	"calendar_event_id" text,
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movie_screenings" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"suggestion_id" integer NOT NULL,
	"event_id" integer,
	"poll_id" integer,
	"scheduled_for" timestamp with time zone,
	"watched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movie_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"year" smallint,
	"note" text,
	"suggested_by" text NOT NULL,
	"tmdb_id" integer,
	"overview" text,
	"poster_url" text,
	"trailer_url" text,
	"links" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_guild_id_role_id_permission_pk" PRIMARY KEY("guild_id","role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "poll_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"ref" text,
	"url" text,
	CONSTRAINT "poll_options_position_unique" UNIQUE("poll_id","position")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"poll_id" integer NOT NULL,
	"option_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_poll_id_user_id_option_id_pk" PRIMARY KEY("poll_id","user_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"creator_id" text NOT NULL,
	"question" text NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"show_results" "poll_result_visibility" DEFAULT 'live' NOT NULL,
	"closes_at" timestamp with time zone,
	"status" "poll_status" DEFAULT 'open' NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text,
	"message" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"recurrence" "reminder_recurrence",
	"timezone" text NOT NULL,
	"status" "reminder_status" DEFAULT 'active' NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_panel_roles" (
	"panel_id" integer NOT NULL,
	"role_id" text NOT NULL,
	"label" text NOT NULL,
	"emoji" text,
	"position" integer NOT NULL,
	CONSTRAINT "role_panel_roles_panel_id_role_id_pk" PRIMARY KEY("panel_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "role_panels" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"kind" "role_panel_kind" NOT NULL,
	"title" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_panels_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movie_screenings" ADD CONSTRAINT "movie_screenings_suggestion_id_movie_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."movie_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_id_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_panel_roles" ADD CONSTRAINT "role_panel_roles_panel_id_role_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."role_panels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_guild_idx" ON "announcements" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "birthdays_date_idx" ON "birthdays" USING btree ("guild_id","month","day");--> statement-breakpoint
CREATE INDEX "event_rsvps_status_idx" ON "event_rsvps" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "events_guild_start_idx" ON "events" USING btree ("guild_id","starts_at");--> statement-breakpoint
CREATE INDEX "movie_screenings_guild_idx" ON "movie_screenings" USING btree ("guild_id","watched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "movie_suggestions_unique_idx" ON "movie_suggestions" USING btree ("guild_id","normalized_title") WHERE "movie_suggestions"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "poll_votes_option_idx" ON "poll_votes" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "polls_guild_status_idx" ON "polls" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "polls_source_idx" ON "polls" USING btree ("guild_id","source","created_at");--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("guild_id","user_id","status");--> statement-breakpoint
CREATE INDEX "role_panels_guild_idx" ON "role_panels" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_panels_reaction_channel_idx" ON "role_panels" USING btree ("guild_id","channel_id") WHERE "role_panels"."kind" = 'reaction';