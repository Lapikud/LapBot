import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { SuggestionStatus } from '~/features/event-suggestions/model';
export const eventSuggestions = pgTable(
  'event_suggestions',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    authorId: text('author_id').notNull(),
    text: text('text').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    status: text('status').$type<SuggestionStatus>().notNull().default('new'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('event_suggestions_guild_id_id').on(table.guildId, table.id),
    check(
      'event_suggestions_status',
      sql`${table.status} IN ('new', 'reviewed', 'dismissed')`,
    ),
  ],
);
