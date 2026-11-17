import { MessageFlags } from 'discord.js';
import type {
  AppContext,
  CommandInteraction,
  SlashCommand,
} from '~/presentation/discord/contracts';

type SubcommandHandler = (
  interaction: CommandInteraction,
  ctx: AppContext,
) => Promise<void>;

export function subcommandPath(interaction: CommandInteraction): string {
  return [
    interaction.options.getSubcommandGroup(false),
    interaction.options.getSubcommand(false),
  ]
    .filter(Boolean)
    .join(' ');
}

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
