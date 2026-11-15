import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
} from 'drizzle-orm/pg-core';

export const birthdayVisibility = pgEnum('birthday_visibility', [
  'public',
  'announce',
  'private',
]);

export const birthdays = pgTable(
  'birthdays',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    month: smallint('month').notNull(),
    day: smallint('day').notNull(),
    visibility: birthdayVisibility('visibility').notNull().default('public'),
    lastAnnouncedYear: integer('last_announced_year'),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    index('birthdays_date_idx').on(table.guildId, table.month, table.day),
  ],
);

export const birthdaySettings = pgTable('birthday_settings', {
  guildId: text('guild_id').primaryKey(),
  channelId: text('channel_id').notNull(),
  roleId: text('role_id'),
  hour: smallint('hour').notNull().default(9),
});

export type Birthday = typeof birthdays.$inferSelect;
export type BirthdayVisibility = Birthday['visibility'];
