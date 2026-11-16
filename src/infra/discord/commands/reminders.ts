import {
  ApplicationCommandType,
  ChannelType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
} from 'discord.js';
import type { Reminder } from '~/core/ports';
import type { ReminderService } from '~/core/services';
import { channelMention, discordTime, recurrences } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand } from '../define';
import type { Feature } from '../module';
import { respond } from '../router';

export function describeReminder(reminder: Reminder): string {
  const where =
    reminder.channelId === null ? 'DM' : channelMention(reminder.channelId);
  const repeat = reminder.recurrence === null ? '' : `, ${reminder.recurrence}`;

  return `#${reminder.id} ${discordTime(reminder.runAt, 'f')} (${where}${repeat}) — ${reminder.message.slice(0, 80)}`;
}

const remindme = new SlashCommandBuilder()
  .setName('remindme')
  .setDescription('Set a reminder')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('message')
      .setDescription('What to remind about')
      .setRequired(true)
      .setMaxLength(1000),
  )
  .addStringOption((o) =>
    o
      .setName('when')
      .setDescription(
        'Default tomorrow. e.g. 30m, 2h, tomorrow 9:00, fri 18:00',
      ),
  )
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Post in a channel instead of DM')
      .addChannelTypes(ChannelType.GuildText),
  )
  .addStringOption((o) =>
    o
      .setName('repeat')
      .setDescription('Repeat the reminder')
      .addChoices(recurrences.map((r) => ({ name: r, value: r }))),
  );

const idOption = (o: SlashCommandIntegerOption) =>
  o
    .setName('id')
    .setDescription('Reminder')
    .setRequired(true)
    .setAutocomplete(true);

const manage = new SlashCommandBuilder()
  .setName('reminders')
  .setDescription('Manage your reminders')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List your active reminders'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Change a reminder')
      .addIntegerOption(idOption)
      .addStringOption((o) =>
        o.setName('when').setDescription('e.g. 2h, tomorrow 9:00'),
      )
      .addStringOption((o) =>
        o.setName('message').setDescription('New message').setMaxLength(1000),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a reminder')
      .addIntegerOption(idOption),
  );

export function reminderCommands(reminders: ReminderService): Feature {
  return {
    name: 'reminders',
    permissions: [
      { id: 'reminder:channel', description: 'Post reminders in channels' },
    ],
    messageCommands: [
      {
        data: new ContextMenuCommandBuilder()
          .setName('Remind me tomorrow')
          .setType(ApplicationCommandType.Message)
          .setContexts(InteractionContextType.Guild)
          .toJSON(),
        execute: async (interaction) => {
          const target = interaction.targetMessage;
          const excerpt = target.content.slice(0, 200);
          const reminder = await reminders.create(toActor(interaction.member), {
            message: [excerpt, target.url].filter(Boolean).join('\n'),
          });

          await respond(
            interaction,
            `I will DM you about ${target.url} ${discordTime(reminder.runAt, 'R')}.`,
          );
        },
      },
    ],
    commands: [
      {
        data: remindme.toJSON(),
        execute: async (interaction) => {
          const channel = interaction.options.getChannel('channel', false, [
            ChannelType.GuildText,
          ]);
          const repeat = interaction.options.getString('repeat');
          const when = interaction.options.getString('when');
          const reminder = await reminders.create(toActor(interaction.member), {
            ...(when !== null && { when }),
            message: interaction.options.getString('message', true),
            ...(channel && { channelId: channel.id }),
            ...(repeat !== null && { repeat }),
          });
          const note = channel
            ? ''
            : ' Make sure you allow DMs from server members.';

          await respond(
            interaction,
            `Reminder set: ${describeReminder(reminder)}.${note}`,
          );
        },
      },
      {
        data: manage.toJSON(),
        execute: bySubcommand({
          list: async (interaction) => {
            const active = await reminders.list(toActor(interaction.member));

            await respond(
              interaction,
              active.length === 0
                ? 'You have no active reminders.'
                : active
                    .map((reminder) => describeReminder(reminder))
                    .join('\n'),
            );
          },
          edit: async (interaction) => {
            const when = interaction.options.getString('when');
            const message = interaction.options.getString('message');
            const updated = await reminders.edit(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
              {
                ...(when !== null && { when }),
                ...(message !== null && { message }),
              },
            );

            await respond(interaction, `Updated: ${describeReminder(updated)}`);
          },
          cancel: async (interaction) => {
            const id = interaction.options.getInteger('id', true);

            await reminders.cancel(toActor(interaction.member), id);
            await respond(interaction, `Cancelled reminder #${id}.`);
          },
        }),
        autocomplete: async (interaction) => {
          const active = await reminders.list(toActor(interaction.member));

          await interaction.respond(
            active.map((r) => ({
              name: `#${r.id} ${r.message}`.slice(0, 100),
              value: r.id,
            })),
          );
        },
      },
    ],
  };
}
