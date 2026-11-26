import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { Mentions } from '~/core/message';
import type { Answer, FormField, FormStatus } from '~/features/forms/model';

export const forms = pgTable('forms', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  fields: jsonb('fields').$type<FormField[]>().notNull().default([]),
  channelId: text('channel_id'),
  messageId: text('message_id'),
  responseChannelId: text('response_channel_id'),
  mentions: jsonb('mentions').$type<Mentions>().notNull().default({}),
  createdBy: text('created_by').notNull(),
  status: text('status').$type<FormStatus>().notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const formResponses = pgTable(
  'form_responses',
  {
    id: serial('id').primaryKey(),
    formId: integer('form_id')
      .notNull()
      .references(() => forms.id),
    userId: text('user_id').notNull(),
    answers: jsonb('answers').$type<Answer[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('form_responses_form_idx').on(table.formId)],
);
