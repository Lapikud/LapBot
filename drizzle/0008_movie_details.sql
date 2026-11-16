ALTER TABLE "movie_suggestions" ADD COLUMN "tmdb_id" integer;--> statement-breakpoint
ALTER TABLE "movie_suggestions" ADD COLUMN "overview" text;--> statement-breakpoint
ALTER TABLE "movie_suggestions" ADD COLUMN "poster_url" text;--> statement-breakpoint
ALTER TABLE "movie_suggestions" ADD COLUMN "trailer_url" text;--> statement-breakpoint
ALTER TABLE "movie_suggestions" ADD COLUMN "links" text[] DEFAULT '{}' NOT NULL;