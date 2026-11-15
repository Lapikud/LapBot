import { randomUUID } from 'node:crypto';
import {
  MessageFlags,
  type AutocompleteInteraction,
  type BaseMessageOptions,
  type Interaction,
} from 'discord.js';
import { ignore, UserError } from '~/domain';
import type {
  AppContext,
  CommandInteraction,
  ComponentInteraction,
} from './module';
import { parseCustomId, type Registry } from './registry';

type Repliable = CommandInteraction | ComponentInteraction;

export async function respond(
  interaction: Repliable,
  content: string | Pick<BaseMessageOptions, 'content' | 'embeds'>,
): Promise<void> {
  const message = {
    ...(typeof content === 'string' ? { content } : content),
    allowedMentions: { parse: [] },
  };

  if (interaction.replied) {
    await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
  } else if (interaction.deferred) {
    await interaction.editReply(message);
  } else {
    await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
  }
}

export function subcommandPath(interaction: CommandInteraction): string {
  return [
    interaction.options.getSubcommandGroup(false),
    interaction.options.getSubcommand(false),
  ]
    .filter(Boolean)
    .join(' ');
}

async function runCommand(
  registry: Registry,
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const command = registry.commands.get(interaction.commandName);

  if (!command) {
    throw new UserError('This command is no longer available.');
  }

  const permissions = command.permissions ?? {};
  const required = permissions['*'] ?? permissions[subcommandPath(interaction)];

  if (required !== undefined) {
    await ctx.authz.require(interaction.member, required);
  }

  await command.execute(interaction, ctx);
}

async function runComponent(
  registry: Registry,
  interaction: ComponentInteraction,
  ctx: AppContext,
): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  const handler = parsed && registry.components.get(parsed.prefix);

  if (!parsed || !handler) {
    throw new UserError('This control is no longer active.');
  }

  if (handler.permission !== undefined) {
    await ctx.authz.require(interaction.member, handler.permission);
  }

  await handler.execute(interaction, parsed.args, ctx);
}

async function runAutocomplete(
  registry: Registry,
  interaction: AutocompleteInteraction<'cached'>,
  ctx: AppContext,
): Promise<void> {
  const command = registry.commands.get(interaction.commandName);

  try {
    await command?.autocomplete?.(interaction, ctx);
  } catch (error) {
    ctx.log.warn(
      { err: error, command: interaction.commandName },
      'Autocomplete failed',
    );
  }

  if (!interaction.responded) {
    await interaction.respond([]).catch(ignore);
  }
}

function describe(interaction: Repliable): Record<string, string> {
  return {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    ...(interaction.isChatInputCommand()
      ? {
          command:
            `${interaction.commandName} ${subcommandPath(interaction)}`.trim(),
        }
      : { customId: interaction.customId }),
  };
}

export function createInteractionHandler(
  registry: Registry,
  ctx: AppContext,
): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    if (!interaction.inCachedGuild()) {
      if (interaction.isRepliable()) {
        await interaction
          .reply({
            content: 'Please use me inside the server.',
            flags: MessageFlags.Ephemeral,
          })
          .catch(ignore);
      }

      return;
    }

    if (interaction.isAutocomplete()) {
      await runAutocomplete(registry, interaction, ctx);

      return;
    }

    if (
      !interaction.isChatInputCommand() &&
      !interaction.isMessageComponent() &&
      !interaction.isModalSubmit()
    ) {
      return;
    }

    try {
      await (interaction.isChatInputCommand()
        ? runCommand(registry, interaction, ctx)
        : runComponent(registry, interaction, ctx));
    } catch (error) {
      let message: string;

      if (error instanceof UserError) {
        message = error.message;
        ctx.log.debug(
          { ...describe(interaction), reason: error.message },
          'Interaction rejected',
        );
      } else {
        const ref = randomUUID().slice(0, 8);

        ctx.log.error(
          { err: error, ref, ...describe(interaction) },
          'Interaction failed',
        );
        message = `Something went wrong. Reference: \`${ref}\``;
      }

      await respond(interaction, message).catch((replyError: unknown) => {
        ctx.log.warn({ err: replyError }, 'Could not report interaction error');
      });
    }
  };
}
