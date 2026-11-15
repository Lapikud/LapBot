import { MessageFlags, type ClientEvents } from 'discord.js';
import type { z } from 'zod';
import { PermanentError } from '~/shared/errors';
import { subcommandPath } from '~/core/discord/router';
import type {
  AppContext,
  CommandInteraction,
  EventListener,
  Job,
  JobInfo,
  JobOutcome,
  SlashCommand,
} from './feature';

export function defineJob<S extends z.ZodType>(definition: {
  type: string;
  payload: S;
  maxAttempts?: number;
  handle: (
    payload: z.infer<S>,
    info: JobInfo,
    ctx: AppContext,
  ) => Promise<JobOutcome | undefined>;
}): Job<z.infer<S>> {
  return {
    type: definition.type,
    maxAttempts: definition.maxAttempts ?? 5,
    run: async (raw, info, ctx) => {
      const parsed = definition.payload.safeParse(raw);

      if (!parsed.success) {
        throw new PermanentError(`Invalid payload: ${parsed.error.message}`);
      }

      return (await definition.handle(parsed.data, info, ctx)) ?? null;
    },
  };
}

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
