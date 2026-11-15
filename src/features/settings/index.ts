import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { bySubcommand } from '~/infra/discord';
import type { Feature } from '~/infra/discord';
import { getGuildTimezone, setGuildTimezone } from '~/infra/db';
import { requireZone } from '~/domain';

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
