import type { ClientEvents } from 'discord.js';
import type { AppContext, EventListener } from '~/discord/contracts';

export function createEventListener<K extends keyof ClientEvents>(
  event: K,
  handle: (ctx: AppContext, ...args: ClientEvents[K]) => Promise<void>,
): EventListener {
  return {
    event,
    attach: (client, ctx) => {
      client.on(event, (...args) => {
        handle(ctx, ...args).catch((error: unknown) => {
          ctx.log.error({ error, event }, 'Event listener failed');
        });
      });
    },
  };
}
