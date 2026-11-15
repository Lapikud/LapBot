import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const movieSuggestions = pgTable(
  'movie_suggestions',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    year: smallint('year'),
    note: text('note'),
    suggestedBy: text('suggested_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('movie_suggestions_unique_idx')
      .on(table.guildId, table.normalizedTitle)
      .where(sql`${table.removedAt} IS NULL`),
  ],
);

/**
 * A movie night. Voting and scheduling live in the polls and events features;
 * these IDs only link to them, so they carry no foreign keys across features.
 */
export const movieScreenings = pgTable(
  'movie_screenings',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    suggestionId: integer('suggestion_id')
      .notNull()
      .references(() => movieSuggestions.id),
    eventId: integer('event_id'),
    pollId: integer('poll_id'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    watchedAt: timestamp('watched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('movie_screenings_guild_idx').on(table.guildId, table.watchedAt),
  ],
);

export type MovieSuggestion = typeof movieSuggestions.$inferSelect;
