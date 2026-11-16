import { describe, expect, it, vi } from 'vitest';
import type { Calendar, Scheduler } from '~/core/ports';
import {
  createEventService,
  parseReminderMinutes,
  reminderText,
} from '~/core/services';
import { UserError } from '~/domain';
import { createEventRepository } from '~/infra/db';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from '../../fakes';

const base = () => ({
  guildId: snowflake(),
  title: 'Board game night',
  description: null,
  startsAt: new Date(Date.now() + 3 * 3_600_000),
  endsAt: null,
  timezone: 'Europe/Tallinn',
  location: null,
  organizerId: snowflake(),
  channelId: snowflake(),
  capacity: null,
  mentionRoleId: null,
  reminderMinutes: [],
});

describe('event helpers', () => {
  it('parses reminder minutes', () => {
    expect(parseReminderMinutes(undefined)).toEqual([60]);
    expect(parseReminderMinutes('60, 15,15')).toEqual([60, 15]);
    expect(() => parseReminderMinutes('1,2,3,4')).toThrow(UserError);
  });

  it('keeps reminder pings under the Discord message limit', () => {
    const going = Array.from(
      { length: 200 },
      (_, n) => `1${String(n).padStart(18, '0')}`,
    );
    const { content, pinged } = reminderText(
      {
        ...base(),
        id: 1,
        messageId: 'm',
        discordEventId: null,
        status: 'scheduled',
        createdAt: new Date(),
      },
      60,
      going,
    );

    expect(content.length).toBeLessThanOrEqual(2000);
    expect(pinged.length).toBeGreaterThan(50);
    expect(pinged.length).toBeLessThan(200);
  });
});

describe.skipIf(noDatabase)('event RSVPs', () => {
  const repository = () => createEventRepository(testDb());

  it('records RSVPs and lets members change them without duplicates', async () => {
    const events = repository();
    const event = await events.insert(base());
    const user = snowflake();

    await events.setRsvp(event.id, user, 'going');
    await events.setRsvp(event.id, user, 'maybe');
    await events.setRsvp(event.id, user, 'maybe');
    expect(await events.attendees(event.id)).toEqual([
      { userId: user, status: 'maybe' },
    ]);
    expect(await events.counts(event.id)).toEqual({
      going: 0,
      maybe: 1,
      not_going: 0,
    });
  });

  it('enforces capacity but lets attendees keep their spot', async () => {
    const events = repository();
    const event = await events.insert({ ...base(), capacity: 1 });
    const [first, second] = [snowflake(), snowflake()];

    await events.setRsvp(event.id, first, 'going');
    await events.setRsvp(event.id, first, 'going');
    await expect(events.setRsvp(event.id, second, 'going')).rejects.toThrow(
      'full',
    );
    await events.setRsvp(event.id, first, 'not_going');
    await events.setRsvp(event.id, second, 'going');
    expect((await events.counts(event.id)).going).toBe(1);
  });

  it('never exceeds capacity under concurrent registrations', async () => {
    const events = repository();
    const event = await events.insert({ ...base(), capacity: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        events.setRsvp(event.id, snowflake(), 'going'),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect((await events.counts(event.id)).going).toBe(3);
  });

  it('closes RSVPs once cancelled', async () => {
    const events = repository();
    const event = await events.insert(base());

    await events.update(event.id, { status: 'cancelled' });
    await expect(
      events.setRsvp(event.id, snowflake(), 'going'),
    ).rejects.toBeInstanceOf(UserError);
  });
});

describe.skipIf(noDatabase)('event service', () => {
  const setup = () => {
    const { messenger } = fakeMessenger();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const calendar = {
      upsert: vi.fn<Calendar['upsert']>(async () => 'native'),
      remove: vi.fn<Calendar['remove']>(async () => undefined),
    };
    const service = createEventService({
      events: createEventRepository(testDb()),
      scheduler,
      messenger,
      calendar,
      directory: fakeDirectory(),
      authz: allowAll,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    });

    return {
      service,
      messenger,
      scheduler,
      calendar,
      organizer: actor({ guildId: snowflake(), userId: snowflake() }),
    };
  };

  it('publishes, schedules only future reminders and mirrors natively', async () => {
    const { service, messenger, scheduler, calendar, organizer } = setup();
    const event = await service.create(organizer, {
      title: 'Quiz',
      start: '3h',
      channelId: 'c',
      reminders: '60,600',
      native: true,
    });

    expect(event.messageId).not.toBeNull();
    expect(event.discordEventId).toBe('native');
    expect(messenger.send).toHaveBeenCalledOnce();
    expect(scheduler.schedule).toHaveBeenCalledOnce();
    expect(calendar.upsert).toHaveBeenCalledOnce();
  });

  it('skips reminders for cancelled events and lets only organizers manage', async () => {
    const { service, messenger, organizer } = setup();
    const event = await service.create(organizer, {
      title: 'Quiz',
      start: '3h',
      channelId: 'c',
    });

    await service.cancel(organizer, event.id);
    messenger.send.mockClear();
    await service.jobs[0]?.run({ eventId: event.id, minutes: 60 });
    expect(messenger.send).not.toHaveBeenCalled();
  });

  it('returns an updated view after an RSVP', async () => {
    const { service, organizer } = setup();
    const event = await service.create(organizer, {
      title: 'Quiz',
      start: '3h',
      channelId: 'c',
      capacity: 5,
    });
    const view = await service.rsvp(
      actor({ guildId: organizer.guildId, userId: snowflake() }),
      event.id,
      'going',
    );

    expect(JSON.stringify(view.embeds)).toContain('1 / 5');
  });
});
