import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey(),
  time: integer('time').notNull(),
  level: integer('level').notNull(),
  message: text('message').notNull(),
  source: text('source').notNull(),
  details: text('details').notNull(),
});
