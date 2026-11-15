import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { customId } from '../../core/registry.js';
import type { AppContext, ComponentHandler } from '../../core/feature.js';
import { UserError } from '../../shared/errors.js';
import { selfAssignProblem } from './guards.js';
import { requirePanel, setPanelMessage, type Panel } from './service.js';

export function renderPanel(panel: Panel): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(
      panel.roles.length === 0
        ? 'No roles yet.'
        : panel.roles.map((role) => `• <@&${role.roleId}>`).join('\n'),
    );
  const open = new ButtonBuilder()
    .setCustomId(customId('roles:open', panel.id))
    .setLabel('Choose roles')
    .setStyle(ButtonStyle.Primary);
  return {
    embeds: [embed],
    components:
      panel.roles.length === 0
        ? []
        : [new ActionRowBuilder<ButtonBuilder>().addComponents(open)],
  };
}

/** Re-renders a panel message, reposting it if it was deleted. */
export async function publishPanel(
  ctx: AppContext,
  panel: Panel,
): Promise<void> {
  const channel = await ctx.client.channels
    .fetch(panel.channelId)
    .catch(() => null);
  if (channel?.type !== ChannelType.GuildText) {
    throw new UserError(`I can no longer access <#${panel.channelId}>.`);
  }
  const content = renderPanel(panel);
  if (panel.messageId !== null) {
    const existing = await channel.messages
      .fetch(panel.messageId)
      .catch(() => null);
    if (existing) {
      await existing.edit(content);
      return;
    }
  }
  const message = await channel.send(content);
  await setPanelMessage(ctx.db, panel.id, message.id);
}

function parsePanelId(args: readonly string[]): number {
  const id = Number(args[0]);
  if (!Number.isSafeInteger(id)) {
    throw new UserError('This role panel is invalid.');
  }
  return id;
}

const openHandler: ComponentHandler = {
  prefix: 'roles:open',
  execute: async (interaction, args, ctx) => {
    const panel = await requirePanel(
      ctx.db,
      interaction.guildId,
      parsePanelId(args),
    );
    if (panel.roles.length === 0) {
      throw new UserError('This panel has no roles yet.');
    }
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId('roles:choose', panel.id))
      .setPlaceholder('Select your roles')
      .setMinValues(0)
      .setMaxValues(panel.roles.length)
      .addOptions(
        panel.roles.map((role) => ({
          label: role.label,
          value: role.roleId,
          default: interaction.member.roles.cache.has(role.roleId),
        })),
      );
    await interaction.reply({
      content:
        'Pick the roles you want. Unselected roles from this panel are removed.',
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

const chooseHandler: ComponentHandler = {
  prefix: 'roles:choose',
  execute: async (interaction, args, ctx) => {
    if (!interaction.isStringSelectMenu()) {
      return;
    }
    await interaction.deferUpdate();
    const panel = await requirePanel(
      ctx.db,
      interaction.guildId,
      parsePanelId(args),
    );
    const wanted = new Set(interaction.values);
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    const skipped: string[] = [];

    // Re-validated against the panel's current roles; submitted values are untrusted.
    for (const { roleId, label } of panel.roles) {
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role || selfAssignProblem(role) !== undefined) {
        skipped.push(label);
        continue;
      }
      const has = interaction.member.roles.cache.has(roleId);
      if (wanted.has(roleId) && !has) {
        toAdd.push(roleId);
      } else if (!wanted.has(roleId) && has) {
        toRemove.push(roleId);
      }
    }
    if (toAdd.length > 0) {
      await interaction.member.roles.add(toAdd, 'Role panel selection');
    }
    if (toRemove.length > 0) {
      await interaction.member.roles.remove(toRemove, 'Role panel selection');
    }
    ctx.log.info(
      {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        toAdd,
        toRemove,
      },
      'Updated roles from panel',
    );
    const lines = [
      toAdd.length + toRemove.length === 0
        ? 'No changes.'
        : 'Your roles are updated.',
      ...(skipped.length > 0
        ? [`Unavailable right now: ${skipped.join(', ')}`]
        : []),
    ];
    await interaction.editReply({ content: lines.join('\n'), components: [] });
  },
};

export const panelComponents = [openHandler, chooseHandler];
