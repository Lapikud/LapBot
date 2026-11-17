CREATE TABLE "event_suggestions" (
  "id" serial PRIMARY KEY NOT NULL,
  "guild_id" text NOT NULL,
  "author_id" text NOT NULL,
  "text" text NOT NULL,
  "channel_id" text NOT NULL,
  "message_id" text,
  "status" text DEFAULT 'new' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_suggestions_status" CHECK ("status" IN ('new', 'reviewed', 'dismissed'))
);
CREATE INDEX "event_suggestions_guild_id_id" ON "event_suggestions" ("guild_id", "id");
