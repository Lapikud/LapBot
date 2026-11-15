import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { SettingsService } from '~/core/services';
import { toActor } from '../actor';
import { bySubcommand } from '../define';
import type { Feature } from '../module';
import { respond } from '../router';

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

export function settingsCommands(settings: SettingsService): Feature {
  return {
    name: 'settings',
    permissions: [
      { id: 'settings:manage', description: 'Change server-wide bot settings' },
    ],
    commands: [
      {
        data: data.toJSON(),
        execute: bySubcommand({
          timezone: async (interaction) => {
            const zone = interaction.options.getString('zone');

            if (zone !== null) {
              await settings.setTimezone(toActor(interaction.member), zone);
            }

            const current = await settings.timezone(interaction.guildId);

            await respond(interaction, `Server timezone: **${current}**`);
          },
        }),
      },
    ],
  };
}
