import { expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { createDiscordCalendar } from '~/integrations/discord/calendar';

it('creates updates and removes calendar entries with provider limits', async () => {
  const create = vi.fn(async (_input: unknown) => ({ id: 'new' }));
  const edit = vi.fn(async (_id: string, _input: unknown) => undefined);
  const remove = vi.fn(async (_id: string) => undefined);
  const fetch = vi.fn(async (_id: string) => ({
    scheduledEvents: { create, edit, delete: remove },
  }));
  const client = { guilds: { fetch } } as unknown as Client;
  const calendar = createDiscordCalendar(client);
  const input = {
    title: 't'.repeat(101),
    description: 'd'.repeat(1001),
    location: 'l'.repeat(101),
    startsAt: new Date('2026-11-20T16:00:00Z'),
    endsAt: new Date('2026-11-20T18:00:00Z'),
  };

  expect(await calendar.upsert('guild', null, input)).toBe('new');
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    name: 't'.repeat(100),
    description: 'd'.repeat(1000),
    entityMetadata: { location: 'l'.repeat(100) },
    scheduledStartTime: input.startsAt,
    scheduledEndTime: input.endsAt,
  });
  expect(await calendar.upsert('guild', 'existing', input)).toBe('existing');
  expect(edit.mock.calls[0]?.[0]).toBe('existing');
  await calendar.remove('guild', 'existing');
  expect(remove).toHaveBeenCalledWith('existing');
  fetch.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(calendar.upsert('guild', null, input)).rejects.toThrow(
    'Unavailable',
  );
});
