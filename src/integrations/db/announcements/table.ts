import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { Mentions } from '~/core/message';

export const postStatus = pgEnum('announcement_status', [
  'draft',
  'scheduled',
  'published',
  'cancelled',
]);

export const posts = pgTable(
  'announcements',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    authorId: text('author_id').notNull(),
    channelId: text('channel_id').notNull(),
    title: text('title'),
    content: text('content').notNull(),
    mentionRoleIds: text('mention_role_ids').array().notNull().default([]),
    mentions: jsonb('mentions').$type<Mentions>().notNull().default({}),
    status: postStatus('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    messageIds: text('message_ids').array().notNull().default([]),
    failure: text('failure'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('announcements_guild_idx').on(table.guildId, table.status)],
);

export type AnnouncementRow = typeof posts.$inferSelect;
