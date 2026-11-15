import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { bySubcommand } from '../../core/define.js';
import type { Feature } from '../../core/feature.js';
import {
  getGuildTimezone,
  setGuildTimezone,
} from '../../core/guild-settings.js';
import { requireZone } from '../../shared/time.js';

const data = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Server-wide bot settings')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('timezone')
      .setDescription('View or set the server timezone used for schedules')
      .addStringOption((o) =>
        o.setName('zone').setDescription('IANA timezone, e.g. Europe/Tallinn'),
      ),
  );

export const settingsFeature: Feature = {
  name: 'settings',
  permissions: [
    { id: 'settings:manage', description: 'Change server-wide bot settings' },
  ],
  commands: [
    {
      data: data.toJSON(),
      execute: bySubcommand({
        timezone: async (interaction, ctx) => {
          const zone = interaction.options.getString('zone');
          if (zone !== null) {
            await ctx.authz.require(interaction.member, 'settings:manage');
            await setGuildTimezone(
              ctx.db,
              interaction.guildId,
              requireZone(zone),
            );
          }
          const current = await getGuildTimezone(
            ctx.db,
            interaction.guildId,
            ctx.config.DEFAULT_TIMEZONE,
          );
          await interaction.reply({
            content: `Server timezone: **${current}**`,
            flags: MessageFlags.Ephemeral,
          });
        },
      }),
    },
  ],
};
