import {
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const redmineLinks = pgTable('redmine_links', {
  userId: text('user_id').primaryKey(),
  redmineUserId: integer('redmine_user_id').notNull(),
  redmineLogin: text('redmine_login').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const redmineSubscriptions = pgTable(
  'redmine_subscriptions',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    projectId: integer('project_id').notNull(),
    projectName: text('project_name').notNull(),
    createdBy: text('created_by').notNull(),
    checkpoint: timestamp('checkpoint', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('redmine_subscriptions_unique').on(table.channelId, table.projectId),
  ],
);

export const redmineNotifications = pgTable(
  'redmine_notifications',
  {
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => redmineSubscriptions.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.subscriptionId, table.key] })],
);

export type RedmineLink = typeof redmineLinks.$inferSelect;
export type RedmineSubscription = typeof redmineSubscriptions.$inferSelect;
