import { MessageFlags, type ClientEvents } from 'discord.js';
import { subcommandPath } from './router';
import type {
  AppContext,
  CommandInteraction,
  EventListener,
  SlashCommand,
} from './module';

export function defineListener<K extends keyof ClientEvents>(
  event: K,
  handle: (ctx: AppContext, ...args: ClientEvents[K]) => Promise<void>,
): EventListener {
  return {
    event,
    attach: (client, ctx) => {
      client.on(event, (...args) => {
        handle(ctx, ...args).catch((error: unknown) => {
          ctx.log.error({ err: error, event }, 'Event listener failed');
        });
      });
    },
  };
}

type SubcommandHandler = (
  interaction: CommandInteraction,
  ctx: AppContext,
) => Promise<void>;

export function bySubcommand(
  handlers: Record<string, SubcommandHandler>,
): SlashCommand['execute'] {
  return async (interaction, ctx) => {
    const path = subcommandPath(interaction);
    const handler = handlers[path];

    if (!handler) {
      throw new Error(`No handler for /${interaction.commandName} ${path}`);
    }

    await handler(interaction, ctx);
  };
}

export function deferred(handler: SubcommandHandler): SubcommandHandler {
  return async (interaction, ctx) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await handler(interaction, ctx);
  };
}
