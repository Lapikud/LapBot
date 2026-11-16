import {
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { describeBirthday, type BirthdayService } from '~/core/services';
import { birthdayVisibilities, birthdayVisibilityLabels } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand } from '../define';
import type { ComponentHandler, Feature } from '../module';
import { respond } from '../router';

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

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
          .setDescription('Who gets to know (default: announce and list it)')
          .addChoices(
            birthdayVisibilities.map((v) => ({
              name: birthdayVisibilityLabels[v],
              value: v,
            })),
          ),
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
      .setName('post')
      .setDescription('Post a message with an "Add my birthday" button')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post it (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
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
  const add: ComponentHandler = {
    prefix: 'birthdays:add',
    execute: async (interaction) => {
      if (!interaction.isButton()) {
        return;
      }

      const current = await birthdays.view(
        toActor(interaction.member),
        interaction.user.id,
      );
      const day = new TextInputBuilder()
        .setCustomId('day')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(2)
        .setPlaceholder('e.g. 17');

      if (current) {
        day.setValue(String(current.day));
      }

      await interaction.showModal(
        new ModalBuilder()
          .setCustomId('birthdays:save')
          .setTitle('Your birthday')
          .addLabelComponents(
            new LabelBuilder().setLabel('Month').setStringSelectMenuComponent(
              new StringSelectMenuBuilder().setCustomId('month').addOptions(
                months.map((name, index) => ({
                  label: name,
                  value: String(index + 1),
                  default: current?.month === index + 1,
                })),
              ),
            ),
            new LabelBuilder().setLabel('Day').setTextInputComponent(day),
            new LabelBuilder()
              .setLabel('Who gets to know')
              .setStringSelectMenuComponent(
                new StringSelectMenuBuilder()
                  .setCustomId('visibility')
                  .addOptions(
                    birthdayVisibilities.map((value) => ({
                      label: birthdayVisibilityLabels[value],
                      value,
                      default: (current?.visibility ?? 'public') === value,
                    })),
                  ),
              ),
          ),
      );
    },
  };

  const save: ComponentHandler = {
    prefix: 'birthdays:save',
    execute: async (interaction) => {
      if (!interaction.isModalSubmit()) {
        return;
      }

      const [month = ''] = interaction.fields.getStringSelectValues('month');
      const [visibility = 'public'] =
        interaction.fields.getStringSelectValues('visibility');
      const saved = await birthdays.set(toActor(interaction.member), {
        day: Number(interaction.fields.getTextInputValue('day')),
        month: Number(month),
        visibility,
      });

      await respond(interaction, `Saved. ${birthdayVisibilityLabels[saved]}.`);
    },
  };

  return {
    components: [add, save],
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

            await respond(
              interaction,
              `Saved. ${birthdayVisibilityLabels[visibility]}.${leap}`,
            );
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
          post: async (interaction) => {
            const channelId =
              interaction.options.getChannel('channel')?.id ??
              interaction.channelId;

            await birthdays.postSignup(toActor(interaction.member), channelId);
            await respond(interaction, 'Posted.');
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
