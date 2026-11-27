import { describe, expect, it, vi } from 'vitest';
import { createEventService } from '~/features/events/service';
import type { Event, EventRepository } from '~/features/events/model';
import type { Calendar } from '~/core/ports/calendar';
import {
  actor,
  allowAll,
  denyAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from './fakes';

function fixture(authz = allowAll) {
  const event: Event = {
    id: 1,
    guildId: 'g',
    title: 'Park',
    description: null,
    startsAt: new Date(Date.now() + 86_400_000),
    endsAt: null,
    timezone: 'UTC',
    location: null,
    organizerId: 'u',
    channelId: 'c',
    messageId: 'm',
    capacity: null,
    mentions: {},
    reminderMinutes: [],
    icons: true,
    calendarEventId: null,
    pollId: null,
    status: 'scheduled',
    createdAt: new Date(),
  };
  const events = {
    find: vi.fn(async () => event),
    update: vi.fn(async (_id: number, changes: Partial<Event>) =>
      Object.assign(event, changes),
    ),
    counts: vi.fn(async () => ({ going: 0, maybe: 0, not_going: 0 })),
  } as unknown as EventRepository;
  const calendar: Calendar = {
    upsert: vi.fn(async () => 'calendar-id'),
    remove: vi.fn(async () => undefined),
    between: vi.fn(async () => []),
  };
  const directory = fakeDirectory();
  const service = createEventService({
    events,
    calendar,
    authz,
    directory,
    messenger: fakeMessenger().messenger,
    scheduler: { schedule: vi.fn(), cancel: vi.fn() },
    log: silentLog,
    timezone: 'UTC',
  });

  return { event, events, calendar, directory, service };
}

describe('event calendar crossposting', () => {
  it('requires calendar permission even for an existing event organizer', async () => {
    const { service, calendar } = fixture(denyAll);

    await expect(service.crosspost(actor(), 1)).rejects.toThrow('denied');
    expect(calendar.upsert).not.toHaveBeenCalled();
  });
  it('crossposts existing events and records their calendar ID', async () => {
    const { service, event } = fixture();

    await service.crosspost(actor(), 1);
    expect(event.calendarEventId).toBe('calendar-id');
  });
  it('refuses private channel crossposts', async () => {
    const { service, directory, calendar } = fixture();

    directory.isPublic.mockResolvedValue(false);
    await expect(service.crosspost(actor(), 1)).rejects.toThrow(
      'everyone can see',
    );
    expect(calendar.upsert).not.toHaveBeenCalled();
  });
  it('reports failed synchronization without recording a successful crosspost', async () => {
    const { service, event, calendar } = fixture();

    vi.mocked(calendar.upsert).mockRejectedValue(new Error('offline'));
    await expect(service.crosspost(actor(), 1)).rejects.toThrow(
      'synchronization failed',
    );
    expect(event.calendarEventId).toBeNull();
  });
});
