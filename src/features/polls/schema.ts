import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const pollStatus = pgEnum('poll_status', [
  'open',
  'closed',
  'cancelled',
]);
export const pollResultVisibility = pgEnum('poll_result_visibility', [
  'live',
  'closed',
]);

export const polls = pgTable(
  'polls',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    creatorId: text('creator_id').notNull(),
    question: text('question').notNull(),
    multiple: boolean('multiple').notNull().default(false),
    anonymous: boolean('anonymous').notNull().default(false),
    showResults: pollResultVisibility('show_results').notNull().default('live'),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    status: pollStatus('status').notNull().default('open'),
    /** The feature that created the poll, e.g. 'movies'; null for /poll. */
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('polls_guild_status_idx').on(table.guildId, table.status),
    index('polls_source_idx').on(table.guildId, table.source, table.createdAt),
  ],
);

export const pollOptions = pgTable(
  'poll_options',
  {
    id: serial('id').primaryKey(),
    pollId: integer('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    /** An identifier owned by the source feature, e.g. a movie suggestion. */
    ref: text('ref'),
  },
  (table) => [
    unique('poll_options_position_unique').on(table.pollId, table.position),
  ],
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: integer('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    optionId: integer('option_id')
      .notNull()
      .references(() => pollOptions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.pollId, table.userId, table.optionId] }),
    index('poll_votes_option_idx').on(table.optionId),
  ],
);

export type Poll = typeof polls.$inferSelect;
export type PollOption = typeof pollOptions.$inferSelect;
