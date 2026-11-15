import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { z } from 'zod';
import { respond } from '~/core/discord/router';
import { bySubcommand, defineJob } from '~/core/define';
import { asJobError } from '~/core/discord/errors';
import type { AppContext, CommandInteraction, Feature } from '~/core/feature';
import { getGuildTimezone } from '~/core/guild-settings';
import { PermanentError, UserError } from '~/shared/errors';
import {
  discordTime,
  nextFutureOccurrence,
  parseFutureWhen,
  recurrences,
  requireZone,
} from '~/shared/time';
import type { Reminder } from './schema';
import {
  getReminder,
  insertReminder,
  listActiveReminders,
  requireOwnReminder,
  updateReminder,
  type NewReminder,
} from './service';

const jobKey = (id: number) => `reminder:${id}`;

async function deliver(ctx: AppContext, reminder: Reminder): Promise<void> {
  const text = `⏰ **Reminder:** ${reminder.message}`;

  if (reminder.channelId === null) {
    const user = await ctx.client.users.fetch(reminder.userId);

    await user.send({ content: text });

    return;
  }

  const channel = await ctx.client.channels.fetch(reminder.channelId);

  if (channel?.isSendable() !== true) {
    throw new PermanentError('Reminder channel is not a text channel');
  }

  await channel.send({
    content: `<@${reminder.userId}> ${text}`,
    allowedMentions: { users: [reminder.userId] },
  });
}

export const deliverJob = defineJob({
  type: 'reminders:deliver',
  payload: z.object({ reminderId: z.number().int() }),
  handle: async ({ reminderId }, _info, ctx) => {
    const reminder = await getReminder(ctx.db, reminderId);

    if (reminder?.status !== 'active') {
      return null;
    }

    try {
      await deliver(ctx, reminder);
    } catch (error) {
      const jobError = asJobError(error);

      if (jobError instanceof PermanentError) {
        await updateReminder(ctx.db, reminder.id, {
          status: 'failed',
          failure: jobError.message,
        });
      }

      throw jobError;
    }

    if (reminder.recurrence === null) {
      await updateReminder(ctx.db, reminder.id, { status: 'done' });

      return null;
    }

    const next = nextFutureOccurrence(
      reminder.runAt,
      reminder.recurrence,
      reminder.timezone,
    );

    await updateReminder(ctx.db, reminder.id, { runAt: next });

    return { rescheduleAt: next };
  },
});

export async function createReminder(
  ctx: AppContext,
  input: NewReminder,
): Promise<Reminder> {
  const reminder = await insertReminder(ctx.db, input);

  await ctx.scheduler.schedule(
    deliverJob,
    { reminderId: reminder.id },
    {
      runAt: reminder.runAt,
      key: jobKey(reminder.id),
    },
  );

  return reminder;
}

export function describeReminder(reminder: Reminder): string {
  const where = reminder.channelId === null ? 'DM' : `<#${reminder.channelId}>`;
  const repeat = reminder.recurrence === null ? '' : `, ${reminder.recurrence}`;

  return `#${reminder.id} ${discordTime(reminder.runAt, 'f')} (${where}${repeat}) — ${reminder.message.slice(0, 80)}`;
}

const remindme = new SlashCommandBuilder()
  .setName('remindme')
  .setDescription('Set a reminder')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('when')
      .setDescription('e.g. 30m, 2h, 1d, 18:30, 2026-11-20 18:00')
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('message')
      .setDescription('What to remind about')
      .setRequired(true)
      .setMaxLength(1000),
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
  )
  .addStringOption((o) =>
    o.setName('timezone').setDescription('IANA timezone for absolute times'),
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
      .addStringOption((o) => o.setName('when').setDescription('New time'))
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

async function zoneFor(
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<string> {
  const explicit = interaction.options.getString('timezone');

  return explicit === null
    ? getGuildTimezone(ctx.db, interaction.guildId, ctx.config.DEFAULT_TIMEZONE)
    : requireZone(explicit);
}

export const remindersFeature: Feature = {
  name: 'reminders',
  permissions: [
    { id: 'reminder:channel', description: 'Post reminders in channels' },
  ],
  jobs: [deliverJob],
  commands: [
    {
      data: remindme.toJSON(),
      execute: async (interaction, ctx) => {
        const channel = interaction.options.getChannel('channel', false, [
          ChannelType.GuildText,
        ]);

        if (channel) {
          await ctx.authz.require(interaction.member, 'reminder:channel');
        }

        const timezone = await zoneFor(interaction, ctx);
        const reminder = await createReminder(ctx, {
          guildId: interaction.guildId,
          userId: interaction.user.id,
          channelId: channel?.id ?? null,
          message: interaction.options.getString('message', true),
          runAt: parseFutureWhen(
            interaction.options.getString('when', true),
            timezone,
          ),
          recurrence:
            recurrences.find(
              (r) => r === interaction.options.getString('repeat'),
            ) ?? null,
          timezone,
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
        list: async (interaction, ctx) => {
          const active = await listActiveReminders(
            ctx.db,
            interaction.guildId,
            interaction.user.id,
          );

          await respond(
            interaction,
            active.length === 0
              ? 'You have no active reminders.'
              : active.map((reminder) => describeReminder(reminder)).join('\n'),
          );
        },
        edit: async (interaction, ctx) => {
          const reminder = await requireOwnReminder(
            ctx.db,
            interaction.guildId,
            interaction.user.id,
            interaction.options.getInteger('id', true),
          );
          const when = interaction.options.getString('when');
          const message =
            interaction.options.getString('message') ?? reminder.message;

          if (when === null && message === reminder.message) {
            throw new UserError('Give a new time or message.');
          }

          const runAt =
            when === null
              ? reminder.runAt
              : parseFutureWhen(when, reminder.timezone);

          await updateReminder(ctx.db, reminder.id, { message, runAt });
          await ctx.scheduler.schedule(
            deliverJob,
            { reminderId: reminder.id },
            { runAt, key: jobKey(reminder.id) },
          );
          await respond(
            interaction,
            `Updated: ${describeReminder({ ...reminder, message, runAt })}`,
          );
        },
        cancel: async (interaction, ctx) => {
          const reminder = await requireOwnReminder(
            ctx.db,
            interaction.guildId,
            interaction.user.id,
            interaction.options.getInteger('id', true),
          );

          await updateReminder(ctx.db, reminder.id, { status: 'cancelled' });
          await ctx.scheduler.cancel(jobKey(reminder.id));
          await respond(interaction, `Cancelled reminder #${reminder.id}.`);
        },
      }),
      autocomplete: async (interaction, ctx) => {
        const active = await listActiveReminders(
          ctx.db,
          interaction.guildId,
          interaction.user.id,
        );

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
