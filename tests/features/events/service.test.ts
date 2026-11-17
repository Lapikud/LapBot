import { describe, expect, it, vi } from 'vitest';
import type { Calendar } from '~/core/ports/calendar';
import type { Scheduler } from '~/core/ports/scheduler';
import { createEventRepository } from '~/features/events/repository';
import { createEventService } from '~/features/events/service';
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
