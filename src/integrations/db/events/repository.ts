import { and, asc, count, eq, gte, lt, ne } from 'drizzle-orm';
import type { EventRepository, RsvpCounts } from '~/features/events/model';
import type { Db } from '../client';
import { UserError } from '~/core/errors';
import { eventRsvps, events } from './table';

export function createEventRepository(db: Db): EventRepository {
  return {
    insert: async (input) => {
      if (input.endsAt && input.endsAt <= input.startsAt) {
        throw new UserError('The end must be after the start.');
      }

      const [row] = await db.insert(events).values(input).returning();

      if (!row) {
        throw new Error('Insert returned no row');
      }

      return row;
    },
    find: async (id) => {
      const [row] = await db.select().from(events).where(eq(events.id, id));

      return row;
    },
    upcoming: async (guildId, limit = 25) => {
      return await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.guildId, guildId),
            eq(events.status, 'scheduled'),
            gte(events.startsAt, new Date()),
          ),
        )
        .orderBy(asc(events.startsAt))
        .limit(limit);
    },
    between: async (guildId, from, to) => {
      return await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.guildId, guildId),
            eq(events.status, 'scheduled'),
            gte(events.startsAt, from),
            lt(events.startsAt, to),
          ),
        )
        .orderBy(asc(events.startsAt));
    },
    update: async (id, changes) => {
      const [row] = await db
        .update(events)
        .set(changes)
        .where(eq(events.id, id))
        .returning();

      if (!row) {
        throw new UserError(`Event #${id} does not exist.`);
      }

      return row;
    },
    setRsvp: async (eventId, userId, status) => {
      await db.transaction(async (tx) => {
        const [event] = await tx
          .select({
            status: events.status,
            capacity: events.capacity,
            startsAt: events.startsAt,
          })
          .from(events)
          .where(eq(events.id, eventId))
          .for('update');

        if (event?.status !== 'scheduled') {
          throw new UserError('This event is no longer open for RSVPs.');
        }

        if (status === 'going' && event.capacity !== null) {
          const [others] = await tx
            .select({ total: count() })
            .from(eventRsvps)
            .where(
              and(
                eq(eventRsvps.eventId, eventId),
                eq(eventRsvps.status, 'going'),
                ne(eventRsvps.userId, userId),
              ),
            );

          if ((others?.total ?? 0) >= event.capacity) {
            throw new UserError(
              'This event is full. You can still answer "Maybe".',
            );
          }
        }

        await tx
          .insert(eventRsvps)
          .values({ eventId, userId, status })
          .onConflictDoUpdate({
            target: [eventRsvps.eventId, eventRsvps.userId],
            set: { status, updatedAt: new Date() },
          });
      });
    },
    counts: async (eventId) => {
      const rows = await db
        .select({ status: eventRsvps.status, total: count() })
        .from(eventRsvps)
        .where(eq(eventRsvps.eventId, eventId))
        .groupBy(eventRsvps.status);
      const counts: RsvpCounts = { going: 0, maybe: 0, not_going: 0 };

      for (const row of rows) {
        counts[row.status] = row.total;
      }

      return counts;
    },
    attendees: async (eventId) => {
      return await db
        .select({ userId: eventRsvps.userId, status: eventRsvps.status })
        .from(eventRsvps)
        .where(eq(eventRsvps.eventId, eventId))
        .orderBy(asc(eventRsvps.updatedAt))
        .limit(1000);
    },
  };
}
