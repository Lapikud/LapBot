import { expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { createDiscordMessenger } from '~/infra/discord/adapters';

function setup(canManage = true) {
  const obsolete = vi.fn(async () => undefined);
  const keep = vi.fn(async () => undefined);
  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    guild: { members: { fetchMe: async () => ({}) } },
    permissionsFor: () => ({ has: () => canManage }),
    messages: {
      fetch: async () => ({
        reactions: {
          cache: new Map([
            ['old', { emoji: { name: '1️⃣' }, remove: obsolete }],
            ['keep', { emoji: { name: '🎉' }, remove: keep }],
          ]),
        },
      }),
    },
  };
  const client = {
    channels: { fetch: async () => channel },
  } as unknown as Client;

  return { messenger: createDiscordMessenger(client), obsolete, keep };
}

it('clears obsolete member reactions and keeps configured choices', async () => {
  const { messenger, obsolete, keep } = setup();

  await messenger.clearReactionsExcept('c', 'm', ['🎉']);
  expect(obsolete).toHaveBeenCalledOnce();
  expect(keep).not.toHaveBeenCalled();
});

it('explains missing Manage Messages permission before removing reactions', async () => {
  const { messenger, obsolete } = setup(false);

  await expect(
    messenger.clearReactionsExcept('c', 'm', ['🎉']),
  ).rejects.toThrow('Manage Messages');
  expect(obsolete).not.toHaveBeenCalled();
});
