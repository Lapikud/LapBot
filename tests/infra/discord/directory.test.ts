import { expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { createDiscordDirectory } from '~/infra/discord/directory';

it('refreshes membership before constructing an authorization actor', async () => {
  const fetchMember = vi.fn(async () => ({
    id: 'u',
    guild: { id: 'g', ownerId: 'owner' },
    roles: { cache: new Map([['current-role', {}]]), highest: { position: 1 } },
    permissions: { has: () => false },
  }));
  const client = {
    guilds: { fetch: async () => ({ members: { fetch: fetchMember } }) },
  } as unknown as Client;
  const directory = createDiscordDirectory(client);

  expect(await directory.member('g', 'u')).toMatchObject({
    roleIds: ['current-role'],
    administrator: false,
  });
  expect(fetchMember).toHaveBeenCalledWith({ user: 'u', force: true });
  fetchMember.mockRejectedValueOnce(new Error('Unknown member'));
  expect(await directory.member('g', 'u')).toBeUndefined();
});
