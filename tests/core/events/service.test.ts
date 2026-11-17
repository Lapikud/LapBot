import { describe, expect, it, vi } from 'vitest';
import type { Calendar, Scheduler } from '~/core/ports';
import {
  createEventService,
  eventView,
  parseReminderMinutes,
  reminderText,
} from '~/core/events';
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
  icons: true,
});

describe('event helpers', () => {
  it('parses reminder minutes', () => {
    expect(parseReminderMinutes(undefined)).toEqual([60]);
    expect(parseReminderMinutes('60, 15,15')).toEqual([60, 15]);
    expect(() => parseReminderMinutes('1,2,3,4')).toThrow(UserError);
  });

  it('shows date, time and place with icons unless they are turned off', () => {
    const event = {
      ...base(),
      id: 1,
      messageId: null,
      discordEventId: null,
      status: 'scheduled' as const,
      createdAt: new Date(),
      startsAt: new Date('2026-11-20T16:00:00Z'),
      endsAt: new Date('2026-11-20T19:00:00Z'),
      location: 'Room 101',
    };
    const counts = { going: 0, maybe: 0, not_going: 0 };
    const text = (icons: boolean) =>
      eventView({ ...event, icons }, counts).content ?? '';

    expect(text(true)).toContain('🗓️ <t:');
    expect(text(true)).toContain('🕐 <t:1795190400:t> – <t:1795201200:t>');
    expect(text(true)).toContain('📍 Room 101');
    expect(text(false)).not.toMatch(/🗓️|🕐|📍/u);
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
    const directory = fakeDirectory();
    const service = createEventService({
      events: createEventRepository(testDb()),
      scheduler,
      messenger,
      calendar,
      directory,
      authz: allowAll,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    });

    return {
      service,
      directory,
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

  it('keeps event edits and cancellation working when calendar synchronization fails', async () => {
    const { service, calendar, messenger, organizer } = setup();
    const event = await service.create(organizer, {
      title: 'Quiz',
      start: '3h',
      channelId: 'c',
      native: true,
    });

    calendar.upsert.mockRejectedValueOnce(new Error('Calendar unavailable'));
    const edited = await service.edit(organizer, event.id, {
      title: 'Updated quiz',
    });

    expect(edited.title).toBe('Updated quiz');
    expect(edited.discordEventId).toBe('native');
    expect(messenger.edit).toHaveBeenCalledOnce();
    calendar.remove.mockRejectedValueOnce(new Error('Calendar unavailable'));
    const cancelled = await service.cancel(organizer, event.id);

    expect(cancelled.status).toBe('cancelled');
    expect((await service.get(organizer, event.id)).discordEventId).toBe(
      'native',
    );
    expect(messenger.edit).toHaveBeenCalledTimes(2);
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

    expect(view.content).toContain('1 / 5');
  });

  it('clears nullable fields while leaving omitted changes unchanged', async () => {
    const { service, organizer } = setup();
    const event = await service.create(organizer, {
      title: 'Quiz',
      start: '3h',
      end: '4h',
      channelId: 'c',
      description: 'Details',
      location: 'Room',
      capacity: 5,
    });

    await service.edit(organizer, event.id, { title: 'New quiz' });
    expect(await service.get(organizer, event.id)).toMatchObject({
      description: 'Details',
      location: 'Room',
      capacity: 5,
      endsAt: event.endsAt,
    });
    await service.edit(organizer, event.id, {
      description: null,
      location: null,
      capacity: null,
      end: null,
    });
    expect(await service.get(organizer, event.id)).toMatchObject({
      title: 'New quiz',
      description: null,
      location: null,
      capacity: null,
      endsAt: null,
    });
  });

  it('denies direct reads and edits after channel visibility is lost', async () => {
    const { service, organizer, directory } = setup();
    const event = await service.create(organizer, {
      title: 'Secret',
      start: '3h',
      channelId: 'private',
    });

    directory.canView.mockResolvedValue(false);
    await expect(service.get(organizer, event.id)).rejects.toThrow(
      'does not exist',
    );
    await expect(service.view(organizer, event.id)).rejects.toThrow(
      'does not exist',
    );
    await expect(
      service.edit(organizer, event.id, { title: 'Changed' }),
    ).rejects.toThrow('does not exist');
  });
});
