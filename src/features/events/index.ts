import {
  toActor,
  respond,
  bySubcommand,
  defineJob,
  asJobError,
  isUnknownObject,
  customId,
} from '~/infra/discord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type BaseMessageOptions,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { z } from 'zod';
import type {
  AppContext,
  CommandInteraction,
  ComponentHandler,
  Feature,
} from '~/infra/discord';
import { getGuildTimezone } from '~/infra/db';
import {
  UserError,
  discordTime,
  parseFutureWhen,
  parseWhen,
  requireZone,
} from '~/domain';
import type { Event, RsvpStatus } from './schema';
import {
  getEvent,
  insertEvent,
  listAttendees,
  listUpcoming,
  requireEvent,
  rsvpCounts,
  rsvpStatuses,
  setRsvp,
  updateEvent,
  type NewEvent,
  type RsvpCounts,
} from './service';

const rsvpLabels: Record<RsvpStatus, string> = {
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Not going',
};
const maxReminders = 3;
const defaultNativeDurationMs = 2 * 60 * 60 * 1000;

export function renderEvent(
  event: Event,
  counts: RsvpCounts,
): BaseMessageOptions {
  const cancelled = event.status === 'cancelled';
  const embed = new EmbedBuilder()
    .setTitle(cancelled ? `[Cancelled] ${event.title}` : event.title)
    .setColor(cancelled ? 0x80_80_80 : 0x2b_8a_3e)
    .addFields(
      {
        name: 'When',
        value: `${discordTime(event.startsAt)} (${discordTime(event.startsAt, 'R')})${
          event.endsAt ? ` – ${discordTime(event.endsAt, 'f')}` : ''
        }`,
      },
      ...(event.location === null
        ? []
        : [{ name: 'Where', value: event.location }]),
      { name: 'Organizer', value: `<@${event.organizerId}>`, inline: true },
      {
        name: 'Going',
        value:
          event.capacity === null
            ? String(counts.going)
            : `${counts.going} / ${event.capacity}`,
        inline: true,
      },
      { name: 'Maybe', value: String(counts.maybe), inline: true },
    )
    .setFooter({ text: `Event #${event.id}` });

  if (event.description !== null) {
    embed.setDescription(event.description);
  }

  const buttons = rsvpStatuses.map((status) =>
    new ButtonBuilder()
      .setCustomId(customId('events:rsvp', event.id, status))
      .setLabel(rsvpLabels[status])
      .setStyle(
        status === 'going' ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
  );

  return {
    embeds: [embed],
    components: cancelled
      ? []
      : [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  };
}

async function refreshMessage(ctx: AppContext, event: Event): Promise<void> {
  if (event.messageId === null) {
    return;
  }

  try {
    const channel = await ctx.client.channels.fetch(event.channelId);

    if (channel?.isTextBased() === true) {
      await channel.messages.edit(
        event.messageId,
        renderEvent(event, await rsvpCounts(ctx.db, event.id)),
      );
    }
  } catch (error) {
    if (!isUnknownObject(error)) {
      throw error;
    }

    ctx.log.warn({ eventId: event.id }, 'Event message or channel was deleted');
  }
}

const reminderKey = (id: number, minutes: number) =>
  `event:${id}:remind:${minutes}`;

export const remindJob = defineJob({
  type: 'events:remind',
  payload: z.object({ eventId: z.number().int(), minutes: z.number().int() }),
  handle: async ({ eventId, minutes }, _info, ctx) => {
    const event = await getEvent(ctx.db, eventId);

    if (
      event?.status !== 'scheduled' ||
      event.startsAt.getTime() <= Date.now()
    ) {
      return;
    }

    const attendees = await listAttendees(ctx.db, eventId);
    const going = attendees
      .filter((a) => a.status === 'going')
      .slice(0, 90)
      .map((a) => a.userId);
    const link =
      event.messageId === null
        ? ''
        : ` https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`;
    const pings = going.map((id) => `<@${id}>`).join(' ');

    try {
      const channel = await ctx.client.channels.fetch(event.channelId);

      if (channel?.isSendable() === true) {
        await channel.send({
          content: `⏰ **${event.title}** starts ${discordTime(event.startsAt, 'R')} (${minutes} min reminder).${link}\n${pings}`,
          allowedMentions: { users: going },
        });
      }
    } catch (error) {
      throw asJobError(error);
    }
  },
});

async function scheduleReminders(
  ctx: AppContext,
  event: Event,
  previous: readonly number[] = [],
): Promise<void> {
  await Promise.all(
    previous.map((minutes) =>
      ctx.scheduler.cancel(reminderKey(event.id, minutes)),
    ),
  );

  if (event.status !== 'scheduled') {
    return;
  }

  const upcoming = event.reminderMinutes
    .map((minutes) => ({
      minutes,
      runAt: new Date(event.startsAt.getTime() - minutes * 60_000),
    }))
    .filter(({ runAt }) => runAt.getTime() > Date.now());

  await Promise.all(
    upcoming.map(({ minutes, runAt }) =>
      ctx.scheduler.schedule(
        remindJob,
        { eventId: event.id, minutes },
        { runAt, key: reminderKey(event.id, minutes) },
      ),
    ),
  );
}

async function syncNativeEvent(
  ctx: AppContext,
  event: Event,
): Promise<string | null> {
  try {
    const guild = await ctx.client.guilds.fetch(event.guildId);

    if (event.status === 'cancelled') {
      if (event.discordEventId !== null) {
        await guild.scheduledEvents.delete(event.discordEventId);
      }

      return null;
    }

    const details = {
      name: event.title.slice(0, 100),
      scheduledStartTime: event.startsAt,
      scheduledEndTime:
        event.endsAt ??
        new Date(event.startsAt.getTime() + defaultNativeDurationMs),
      description: (event.description ?? '').slice(0, 1000),
      entityMetadata: {
        location: (event.location ?? 'See the event post').slice(0, 100),
      },
    };

    if (event.discordEventId !== null) {
      await guild.scheduledEvents.edit(event.discordEventId, details);

      return event.discordEventId;
    }

    const created = await guild.scheduledEvents.create({
      ...details,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
    });

    return created.id;
  } catch (error) {
    ctx.log.warn(
      { err: error, eventId: event.id },
      'Could not sync native Discord event',
    );

    return event.discordEventId;
  }
}

export async function createEvent(
  ctx: AppContext,
  input: NewEvent & { native?: boolean },
): Promise<Event> {
  const { native = false, ...values } = input;
  const channel = await ctx.client.channels
    .fetch(values.channelId)
    .catch(() => null);

  if (channel?.isSendable() !== true) {
    throw new UserError('I cannot post in that channel.');
  }

  let event = await insertEvent(ctx.db, values);
  const message = await channel.send({
    ...renderEvent(event, { going: 0, maybe: 0, not_going: 0 }),
    ...(event.mentionRoleId === null
      ? {}
      : {
          content: `<@&${event.mentionRoleId}>`,
          allowedMentions: { roles: [event.mentionRoleId] },
        }),
  });
  const discordEventId = native ? await syncNativeEvent(ctx, event) : null;

  event = await updateEvent(ctx.db, event.id, {
    messageId: message.id,
    discordEventId,
  });
  await scheduleReminders(ctx, event);

  return event;
}

function parseReminderMinutes(value: string | null): number[] {
  if (value === null) {
    return [60];
  }

  if (value.trim() === '') {
    return [];
  }

  const minutes = value.split(',').map((part) => Number(part.trim()));

  if (
    minutes.length > maxReminders ||
    minutes.some((m) => !Number.isInteger(m) || m < 1 || m > 10_080)
  ) {
    throw new UserError(
      `Reminders are up to ${maxReminders} comma-separated minute values, e.g. "60,15".`,
    );
  }

  return [...new Set(minutes)];
}

async function requireManageable(
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<Event> {
  const event = await requireEvent(
    ctx.db,
    interaction.guildId,
    interaction.options.getInteger('id', true),
  );

  if (event.organizerId !== interaction.user.id) {
    await ctx.authz.require(toActor(interaction.member), 'event:manage');
  }

  return event;
}

const rsvpHandler: ComponentHandler = {
  prefix: 'events:rsvp',
  execute: async (interaction, [id, answer], ctx) => {
    const status = rsvpStatuses.find((s) => s === answer);
    const eventId = Number(id);

    if (
      !interaction.isButton() ||
      status === undefined ||
      !Number.isSafeInteger(eventId)
    ) {
      throw new UserError('This button is invalid.');
    }

    await setRsvp(ctx.db, eventId, interaction.user.id, status);
    const event = await getEvent(ctx.db, eventId);

    if (event) {
      await interaction.update(
        renderEvent(event, await rsvpCounts(ctx.db, eventId)),
      );
    }

    await interaction.followUp({
      content: `RSVP saved: **${rsvpLabels[status]}**.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

const idOption = (o: SlashCommandIntegerOption) =>
  o
    .setName('id')
    .setDescription('Event')
    .setRequired(true)
    .setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Organise events')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create and publish an event')
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Title')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName('start')
          .setDescription('e.g. 2026-11-20 18:00')
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Description')
          .setMaxLength(2000),
      )
      .addStringOption((o) => o.setName('end').setDescription('End time'))
      .addStringOption((o) =>
        o.setName('location').setDescription('Place or link').setMaxLength(200),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post (default: here)')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          ),
      )
      .addIntegerOption((o) =>
        o
          .setName('capacity')
          .setDescription('Maximum attendees')
          .setMinValue(1)
          .setMaxValue(10_000),
      )
      .addRoleOption((o) =>
        o.setName('mention').setDescription('Role to notify'),
      )
      .addStringOption((o) =>
        o
          .setName('reminders')
          .setDescription('Minutes before start, e.g. "60,15" (default 60)'),
      )
      .addStringOption((o) =>
        o.setName('timezone').setDescription('IANA timezone for the times'),
      )
      .addBooleanOption((o) =>
        o
          .setName('native')
          .setDescription('Also create a Discord scheduled event'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('Change an event')
      .addIntegerOption(idOption)
      .addStringOption((o) =>
        o.setName('title').setDescription('Title').setMaxLength(200),
      )
      .addStringOption((o) => o.setName('start').setDescription('Start time'))
      .addStringOption((o) => o.setName('end').setDescription('End time'))
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Description')
          .setMaxLength(2000),
      )
      .addStringOption((o) =>
        o.setName('location').setDescription('Place or link').setMaxLength(200),
      )
      .addIntegerOption((o) =>
        o
          .setName('capacity')
          .setDescription('Maximum attendees')
          .setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel an event')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('Upcoming events'))
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('Show an event')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('attendees')
      .setDescription('Who is coming')
      .addIntegerOption(idOption),
  );

async function editEvent(
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const event = await requireManageable(interaction, ctx);

  if (event.status !== 'scheduled') {
    throw new UserError('Cancelled events cannot be edited.');
  }

  const option = (name: string) =>
    interaction.options.getString(name) ?? undefined;
  const start = option('start');
  const end = option('end');
  const changes = {
    title: option('title') ?? event.title,
    description: option('description') ?? event.description,
    location: option('location') ?? event.location,
    capacity: interaction.options.getInteger('capacity') ?? event.capacity,
    startsAt:
      start === undefined
        ? event.startsAt
        : parseFutureWhen(start, event.timezone),
    endsAt: end === undefined ? event.endsAt : parseWhen(end, event.timezone),
  };

  if (changes.endsAt && changes.endsAt <= changes.startsAt) {
    throw new UserError('The end must be after the start.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let updated = await updateEvent(ctx.db, event.id, changes);

  if (updated.discordEventId !== null) {
    updated = await updateEvent(ctx.db, event.id, {
      discordEventId: await syncNativeEvent(ctx, updated),
    });
  }

  await refreshMessage(ctx, updated);
  await scheduleReminders(ctx, updated, event.reminderMinutes);
  ctx.log.info(
    { eventId: event.id, actorId: interaction.user.id },
    'Event edited',
  );
  await interaction.editReply(`Event #${event.id} updated.`);
}

export const eventsFeature: Feature = {
  name: 'events',
  permissions: [
    { id: 'event:create', description: 'Create events' },
    { id: 'event:manage', description: 'Edit and cancel any event' },
  ],
  jobs: [remindJob],
  components: [rsvpHandler],
  commands: [
    {
      data: data.toJSON(),
      permissions: { create: 'event:create' },
      execute: bySubcommand({
        create: async (interaction, ctx) => {
          const zoneOption = interaction.options.getString('timezone');
          const timezone =
            zoneOption === null
              ? await getGuildTimezone(
                  ctx.db,
                  interaction.guildId,
                  ctx.config.DEFAULT_TIMEZONE,
                )
              : requireZone(zoneOption);
          const end = interaction.options.getString('end');
          const mention = interaction.options.getRole('mention');

          if (
            mention &&
            !mention.mentionable &&
            !interaction.member.permissions.has('MentionEveryone')
          ) {
            throw new UserError('You may not mention that role.');
          }

          const input = {
            guildId: interaction.guildId,
            title: interaction.options.getString('title', true),
            description: interaction.options.getString('description'),
            startsAt: parseFutureWhen(
              interaction.options.getString('start', true),
              timezone,
            ),
            endsAt: end === null ? null : parseWhen(end, timezone),
            timezone,
            location: interaction.options.getString('location'),
            organizerId: interaction.user.id,
            channelId:
              interaction.options.getChannel('channel')?.id ??
              interaction.channelId,
            capacity: interaction.options.getInteger('capacity'),
            mentionRoleId: mention?.id ?? null,
            reminderMinutes: parseReminderMinutes(
              interaction.options.getString('reminders'),
            ),
            native: interaction.options.getBoolean('native') ?? false,
          };

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const event = await createEvent(ctx, input);

          ctx.log.info(
            { eventId: event.id, actorId: interaction.user.id },
            'Event created',
          );
          await interaction.editReply(
            `Created event #${event.id} in <#${event.channelId}>.`,
          );
        },
        edit: editEvent,
        cancel: async (interaction, ctx) => {
          const event = await requireManageable(interaction, ctx);

          if (event.status === 'cancelled') {
            throw new UserError('That event is already cancelled.');
          }

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const cancelled = await updateEvent(ctx.db, event.id, {
            status: 'cancelled',
          });

          await Promise.all([
            refreshMessage(ctx, cancelled),
            scheduleReminders(ctx, cancelled, event.reminderMinutes),
            cancelled.discordEventId === null
              ? undefined
              : syncNativeEvent(ctx, cancelled),
          ]);
          ctx.log.info(
            { eventId: event.id, actorId: interaction.user.id },
            'Event cancelled',
          );
          await interaction.editReply(`Event #${event.id} is cancelled.`);
        },
        list: async (interaction, ctx) => {
          const upcoming = await listUpcoming(ctx.db, interaction.guildId);

          await respond(
            interaction,
            upcoming.length === 0
              ? 'No upcoming events.'
              : upcoming
                  .map(
                    (e) =>
                      `#${e.id} **${e.title}** — ${discordTime(e.startsAt, 'f')}`,
                  )
                  .join('\n'),
          );
        },
        view: async (interaction, ctx) => {
          const event = await requireEvent(
            ctx.db,
            interaction.guildId,
            interaction.options.getInteger('id', true),
          );
          const counts = await rsvpCounts(ctx.db, event.id);

          await interaction.reply({
            embeds: renderEvent(event, counts).embeds ?? [],
            flags: MessageFlags.Ephemeral,
          });
        },
        attendees: async (interaction, ctx) => {
          const event = await requireEvent(
            ctx.db,
            interaction.guildId,
            interaction.options.getInteger('id', true),
          );
          const attendees = await listAttendees(ctx.db, event.id);
          const section = (status: RsvpStatus) => {
            const ids = attendees
              .filter((a) => a.status === status)
              .map((a) => `<@${a.userId}>`);

            return `**${rsvpLabels[status]} (${ids.length})**\n${ids.join(' ') || '—'}`;
          };

          await respond(
            interaction,
            rsvpStatuses
              .map((status) => section(status))
              .join('\n\n')
              .slice(0, 2000),
          );
        },
      }),
      autocomplete: async (interaction, ctx) => {
        const upcoming = await listUpcoming(ctx.db, interaction.guildId);

        await interaction.respond(
          upcoming.map((e) => ({
            name: `#${e.id} ${e.title}`.slice(0, 100),
            value: e.id,
          })),
        );
      },
    },
  ],
};
