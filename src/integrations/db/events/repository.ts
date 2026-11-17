import { and, asc, count, eq, gte, ne } from 'drizzle-orm';
import type {
  EventRepository,
  NewEvent,
  RsvpCounts,
} from '~/features/events/model';
import type { Db } from '../client';
import { UserError } from '~/core/errors';
import { eventRsvps, events, type Event, type RsvpStatus } from './table';

export async function insertEvent(db: Db, input: NewEvent): Promise<Event> {
  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw new UserError('The end must be after the start.');
  }

  const [row] = await db.insert(events).values(input).returning();

  if (!row) {
    throw new Error('Insert returned no row');
  }

  return row;
}

export async function getEvent(db: Db, id: number): Promise<Event | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id));

  return row;
}

export async function listUpcoming(
  db: Db,
  guildId: string,
  limit = 25,
): Promise<Event[]> {
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
}

export async function updateEvent(
  db: Db,
  id: number,
  changes: Partial<Omit<Event, 'id' | 'guildId'>>,
): Promise<Event> {
  const [row] = await db
    .update(events)
    .set(changes)
    .where(eq(events.id, id))
    .returning();

  if (!row) {
    throw new UserError(`Event #${id} does not exist.`);
  }

  return row;
}

export async function rsvpCounts(db: Db, eventId: number): Promise<RsvpCounts> {
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
}

export async function setRsvp(
  db: Db,
  eventId: number,
  userId: string,
  status: RsvpStatus,
): Promise<void> {
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
}

export async function listAttendees(
  db: Db,
  eventId: number,
): Promise<Array<{ userId: string; status: RsvpStatus }>> {
  return await db
    .select({ userId: eventRsvps.userId, status: eventRsvps.status })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, eventId))
    .orderBy(asc(eventRsvps.updatedAt))
    .limit(1000);
}

export function createEventRepository(db: Db): EventRepository {
  return {
    insert: (event) => insertEvent(db, event),
    find: (id) => getEvent(db, id),
    upcoming: (guildId, limit) => listUpcoming(db, guildId, limit),
    update: (id, changes) => updateEvent(db, id, changes),
    setRsvp: (eventId, userId, status) => setRsvp(db, eventId, userId, status),
    counts: (eventId) => rsvpCounts(db, eventId),
    attendees: (eventId) => listAttendees(db, eventId),
  };
}
