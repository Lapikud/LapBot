import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';
import { describeBirthday, type BirthdayService } from '~/core/services';
import { birthdayVisibilities } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand } from '../define';
import type { Feature } from '../module';
import { respond } from '../router';

const data = new SlashCommandBuilder()
  .setName('birthday')
  .setDescription('Birthdays')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Save your birthday (no year needed)')
      .addIntegerOption((o) =>
        o
          .setName('day')
          .setDescription('Day')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(31),
      )
      .addIntegerOption((o) =>
        o
          .setName('month')
          .setDescription('Month')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(12),
      )
      .addStringOption((o) =>
        o
          .setName('visibility')
          .setDescription(
            'public: announced and listed; announce: announced only; private: neither',
          )
          .addChoices(birthdayVisibilities.map((v) => ({ name: v, value: v }))),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('remove').setDescription('Delete your birthday data'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('See a birthday')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member (default: you)'),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('upcoming').setDescription('Upcoming public birthdays'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('settings')
      .setDescription('Configure birthday announcements')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Announcement channel')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role to give for the day'),
      )
      .addIntegerOption((o) =>
        o
          .setName('hour')
          .setDescription('Hour to announce (server time)')
          .setMinValue(0)
          .setMaxValue(23),
      )
      .addBooleanOption((o) =>
        o.setName('disable').setDescription('Turn announcements off'),
      ),
  );

export function birthdayCommands(birthdays: BirthdayService): Feature {
  return {
    name: 'birthdays',
    permissions: [
      {
        id: 'birthday:manage',
        description: 'Configure birthday announcements',
      },
    ],
    commands: [
      {
        data: data.toJSON(),
        execute: bySubcommand({
          set: async (interaction) => {
            const day = interaction.options.getInteger('day', true);
            const month = interaction.options.getInteger('month', true);
            const visibility = await birthdays.set(
              toActor(interaction.member),
              {
                day,
                month,
                visibility:
                  interaction.options.getString('visibility') ?? 'public',
              },
            );
            const leap =
              month === 2 && day === 29
                ? ' In non-leap years it is celebrated on 28 February.'
                : '';

            await respond(interaction, `Saved (${visibility}).${leap}`);
          },
          remove: async (interaction) => {
            const removed = await birthdays.remove(toActor(interaction.member));

            await respond(
              interaction,
              removed
                ? 'Your birthday data is deleted.'
                : 'You had no birthday saved.',
            );
          },
          view: async (interaction) => {
            const user =
              interaction.options.getUser('member') ?? interaction.user;
            const birthday = await birthdays.view(
              toActor(interaction.member),
              user.id,
            );

            await respond(
              interaction,
              birthday ? describeBirthday(birthday) : 'No birthday to show.',
            );
          },
          upcoming: async (interaction) => {
            const list = await birthdays.upcoming(interaction.guildId);

            await respond(
              interaction,
              list.length === 0
                ? 'No public birthdays yet.'
                : list.map((birthday) => describeBirthday(birthday)).join('\n'),
            );
          },
          settings: async (interaction) => {
            const channel = interaction.options.getChannel('channel');
            const role = interaction.options.getRole('role');
            const hour = interaction.options.getInteger('hour');
            const message = await birthdays.configure(
              toActor(interaction.member),
              {
                ...(channel && { channelId: channel.id }),
                ...(role && { roleId: role.id }),
                ...(hour !== null && { hour }),
                disable: interaction.options.getBoolean('disable') ?? false,
              },
            );

            await respond(interaction, message);
          },
        }),
      },
    ],
  };
}
