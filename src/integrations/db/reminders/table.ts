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

export const reminderRecurrence = pgEnum('reminder_recurrence', [
  'daily',
  'weekly',
  'monthly',
]);
export const reminderStatus = pgEnum('reminder_status', [
  'active',
  'done',
  'cancelled',
  'failed',
]);

export const reminders = pgTable(
  'reminders',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    channelId: text('channel_id'),
    message: text('message').notNull(),
    mentions: jsonb('mentions').$type<Mentions>().notNull().default({}),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    recurrence: reminderRecurrence('recurrence'),
    timezone: text('timezone').notNull(),
    status: reminderStatus('status').notNull().default('active'),
    failure: text('failure'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('reminders_user_idx').on(table.guildId, table.userId, table.status),
  ],
);

export type Reminder = typeof reminders.$inferSelect;
