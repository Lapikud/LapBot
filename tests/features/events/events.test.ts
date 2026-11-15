import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { AppContext } from '~/core/feature';
import { UserError } from '~/shared/errors';
import { createEvent, remindJob } from '~/features/events';
import {
  insertEvent,
  listAttendees,
  rsvpCounts,
  setRsvp,
  updateEvent,
} from '~/features/events/service';

const base = () => ({
  guildId: snowflake(),
  title: 'Board game night',
  startsAt: new Date(Date.now() + 3 * 3_600_000),
  timezone: 'Europe/Tallinn',
  organizerId: snowflake(),
  channelId: snowflake(),
});

describe.skipIf(noDatabase)('event RSVPs', () => {
  const db = noDatabase ? undefined : testDb();
  const database = () => {
    if (!db) {
      throw new Error('unreachable');
    }

    return db;
  };

  it('records RSVPs and lets members change them without duplicates', async () => {
    const event = await insertEvent(database(), base());
    const user = snowflake();

    await setRsvp(database(), event.id, user, 'going');
    await setRsvp(database(), event.id, user, 'maybe');
    await setRsvp(database(), event.id, user, 'maybe');
    expect(await listAttendees(database(), event.id)).toEqual([
      { userId: user, status: 'maybe' },
    ]);
    expect(await rsvpCounts(database(), event.id)).toEqual({
      going: 0,
      maybe: 1,
      not_going: 0,
    });
  });

  it('enforces capacity but lets attendees keep their spot', async () => {
    const event = await insertEvent(database(), { ...base(), capacity: 1 });
    const [first, second] = [snowflake(), snowflake()];

    await setRsvp(database(), event.id, first, 'going');
    await setRsvp(database(), event.id, first, 'going');
    await expect(
      setRsvp(database(), event.id, second, 'going'),
    ).rejects.toThrow('full');
    await setRsvp(database(), event.id, second, 'maybe');
    await setRsvp(database(), event.id, first, 'not_going');
    await setRsvp(database(), event.id, second, 'going');
    expect((await rsvpCounts(database(), event.id)).going).toBe(1);
  });

  it('never exceeds capacity under concurrent registrations', async () => {
    const event = await insertEvent(database(), { ...base(), capacity: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        setRsvp(database(), event.id, snowflake(), 'going'),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect((await rsvpCounts(database(), event.id)).going).toBe(3);
  });

  it('closes RSVPs once cancelled', async () => {
    const event = await insertEvent(database(), base());

    await updateEvent(database(), event.id, { status: 'cancelled' });
    await expect(
      setRsvp(database(), event.id, snowflake(), 'going'),
    ).rejects.toBeInstanceOf(UserError);
  });

  it('validates times and capacity', async () => {
    const start = new Date(Date.now() + 3_600_000);

    await expect(
      insertEvent(database(), { ...base(), startsAt: start, endsAt: start }),
    ).rejects.toThrow('end');
    await expect(
      insertEvent(database(), { ...base(), capacity: 0 }),
    ).rejects.toThrow('Capacity');
  });

  it('publishes, schedules future reminders and skips reminders for cancelled events', async () => {
    const send = vi.fn(async () => ({ id: snowflake() }));
    const schedule = vi.fn(async () => undefined);
    const ctx = {
      db: database(),
      log: pino({ level: 'silent' }),
      client: {
        channels: { fetch: async () => ({ isSendable: () => true, send }) },
      },
      scheduler: { schedule, cancel: vi.fn() },
    } as unknown as AppContext;
    const event = await createEvent(ctx, {
      ...base(),
      reminderMinutes: [60, 600],
    });

    expect(event.messageId).not.toBeNull();
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(
      remindJob,
      { eventId: event.id, minutes: 60 },
      expect.anything(),
    );

    send.mockClear();
    await updateEvent(database(), event.id, { status: 'cancelled' });
    await remindJob.run(
      { eventId: event.id, minutes: 60 },
      { id: 1, runAt: new Date(), attempt: 1 },
      ctx,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
