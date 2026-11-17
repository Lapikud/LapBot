import { subcommandPath } from '~/discord/commands/handlers';
import { respond } from './responses';
import { randomUUID } from 'node:crypto';
import {
  MessageFlags,
  type AutocompleteInteraction,
  type Interaction,
} from 'discord.js';
import { ignore, UserError } from '~/core/errors';
import type {
  AppContext,
  CommandInteraction,
  ComponentInteraction,
  MessageCommandInteraction,
  Repliable,
} from '~/discord/contracts';
import { toActor } from './actor';
import { parseCustomId, type Registry } from '~/discord/registry';

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
    await ctx.authz.require(toActor(interaction.member), required);
  }

  await command.execute(interaction, ctx);
}

async function runMessageCommand(
  registry: Registry,
  interaction: MessageCommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const command = registry.messageCommands.get(interaction.commandName);

  if (!command) {
    throw new UserError('This command is no longer available.');
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
    await ctx.authz.require(toActor(interaction.member), handler.permission);
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
    ...(interaction.isChatInputCommand() && {
      command:
        `${interaction.commandName} ${subcommandPath(interaction)}`.trim(),
    }),
    ...(interaction.isMessageContextMenuCommand() && {
      command: interaction.commandName,
    }),
    ...((interaction.isMessageComponent() || interaction.isModalSubmit()) && {
      customId: interaction.customId,
    }),
  };
}

function dispatch(
  registry: Registry,
  interaction: Repliable,
  ctx: AppContext,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    return runCommand(registry, interaction, ctx);
  }

  if (interaction.isMessageContextMenuCommand()) {
    return runMessageCommand(registry, interaction, ctx);
  }

  return runComponent(registry, interaction, ctx);
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
            content:
              interaction.guildId === null
                ? 'Please use me inside the server.'
                : 'I am not a member of this server yet. Ask an admin to invite me with the "bot" scope.',
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
      !interaction.isMessageContextMenuCommand() &&
      !interaction.isMessageComponent() &&
      !interaction.isModalSubmit()
    ) {
      return;
    }

    try {
      await dispatch(registry, interaction, ctx);
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
