import { expect, it, vi } from 'vitest';
import type { Event, NewEvent } from '~/domain/events';
import { createEventService } from '~/core/events';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from '../../fakes';

it('rejects oversized event publications and edits before writing records', async () => {
  const member = actor();
  const event = {
    id: 1,
    guildId: member.guildId,
    organizerId: member.userId,
    title: 'Title',
    description: null,
    location: null,
    startsAt: new Date(Date.now() + 86_400_000),
    endsAt: null,
    channelId: 'c',
    timezone: 'UTC',
    capacity: null,
    mentionRoleId: null,
    reminderMinutes: [],
    icons: true,
    status: 'scheduled' as const,
    messageId: null,
    discordEventId: null,
    createdAt: new Date(),
  };
  const insert = vi.fn(async (input: NewEvent) => ({ ...event, ...input }));
  const update = vi.fn(async (_id: number, changes: Partial<Event>) => ({
    ...event,
    ...changes,
  }));
  const { messenger } = fakeMessenger();
  const service = createEventService({
    events: {
      insert,
      update,
      find: async () => event,
      counts: async () => ({ going: 0, maybe: 0, not_going: 0 }),
    },
    directory: fakeDirectory(),
    authz: allowAll,
    messenger,
    log: silentLog,
    timezone: 'UTC',
    scheduler: {},
    calendar: {},
  } as unknown as Parameters<typeof createEventService>[0]);
  const long = {
    title: 't'.repeat(200),
    description: 'd'.repeat(1500),
    location: 'l'.repeat(200),
  };

  await expect(service.publish(member, { ...event, ...long })).rejects.toThrow(
    '2000',
  );
  await expect(service.edit(member, 1, long)).rejects.toThrow('2000');
  expect(insert).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(messenger.send).not.toHaveBeenCalled();

  await service.publish(member, event);
  expect(insert).toHaveBeenCalledOnce();
  expect(messenger.send).toHaveBeenCalledOnce();
});
