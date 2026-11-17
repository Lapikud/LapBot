import { expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { createDiscordMessenger } from '~/integrations/discord/messenger';

function setup() {
  const obsolete = vi.fn(async () => undefined);
  const keep = vi.fn(async () => undefined);
  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    guild: { members: { fetchMe: async () => ({}) } },
    permissionsFor: () => ({ has: () => true }),
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
