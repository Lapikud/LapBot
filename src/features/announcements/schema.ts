import {
  boolean,
  index,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const announcementStatus = pgEnum('announcement_status', [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'cancelled',
  'failed',
]);

export const announcements = pgTable(
  'announcements',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    authorId: text('author_id').notNull(),
    channelId: text('channel_id').notNull(),
    title: text('title'),
    content: text('content').notNull(),
    embed: boolean('embed').notNull().default(true),
    mentionRoleId: text('mention_role_id'),
    status: announcementStatus('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    messageId: text('message_id'),
    failure: text('failure'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('announcements_guild_idx').on(table.guildId, table.status)],
);

export type Announcement = typeof announcements.$inferSelect;
