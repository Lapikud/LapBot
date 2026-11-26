import {
  boolean,
  index,
  jsonb,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { Mentions } from '~/core/message';

export const eventStatus = pgEnum('event_status', ['scheduled', 'cancelled']);
export const rsvpStatus = pgEnum('rsvp_status', [
  'going',
  'maybe',
  'not_going',
]);

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    timezone: text('timezone').notNull(),
    location: text('location'),
    organizerId: text('organizer_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    capacity: integer('capacity'),
    mentionRoleId: text('mention_role_id'),
    mentions: jsonb('mentions').$type<Mentions>().notNull().default({}),
    reminderMinutes: integer('reminder_minutes').array().notNull().default([]),
    icons: boolean('icons').notNull().default(true),
    calendarEventId: text('calendar_event_id'),
    status: eventStatus('status').notNull().default('scheduled'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('events_guild_start_idx').on(table.guildId, table.startsAt),
  ],
);

export const eventRsvps = pgTable(
  'event_rsvps',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    status: rsvpStatus('status').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index('event_rsvps_status_idx').on(table.eventId, table.status),
  ],
);

export type Event = typeof events.$inferSelect;
export type RsvpStatus = (typeof rsvpStatus.enumValues)[number];
