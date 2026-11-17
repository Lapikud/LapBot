import { visibleRecords } from '~/core/helpers/visibility';
import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { rsvpStatuses, type RsvpStatus } from '~/features/events/model';
import type { Directory } from '~/core/ports/directory';
import { reminderChoices, type EventService } from '~/features/events/service';
import { rsvpLabels } from '~/features/events/message';
import { channelMention, userMention } from '~/core/message';
import { discordTime } from '~/core/helpers/time';
import { UserError } from '~/core/errors';
import { toActor } from '~/discord/interactions/actor';
import { bySubcommand, deferred } from './handlers';
import type {
  CommandInteraction,
  ComponentHandler,
  Feature,
} from '~/discord/contracts';
import { render } from '~/discord/render';
import { respond, respondView } from '~/discord/interactions/responses';

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
          .setDescription('e.g. fri 18:00, tomorrow 19:00, 20/11 18:00')
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Description')
          .setMaxLength(1500),
      )
      .addStringOption((o) =>
        o.setName('end').setDescription('e.g. 21:00 or 3h after the start'),
      )
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
          .setDescription(
            'When to remind people who are going (default 1 hour before)',
          )
          .addChoices(
            reminderChoices.map(({ label, value }) => ({ name: label, value })),
          ),
      )
      .addBooleanOption((o) =>
        o
          .setName('native')
          .setDescription('Also create a Discord scheduled event'),
      )
      .addBooleanOption((o) =>
        o.setName('icons').setDescription('Show 🗓️ 🕐 📍 icons (default yes)'),
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
      .addStringOption((o) =>
        o.setName('start').setDescription('e.g. fri 18:00 or 20/11 18:00'),
      )
      .addStringOption((o) => o.setName('end').setDescription('End time'))
      .addStringOption((o) =>
        o
          .setName('description')
          .setDescription('Description')
          .setMaxLength(1500),
      )
      .addStringOption((o) =>
        o.setName('location').setDescription('Place or link').setMaxLength(200),
      )
      .addIntegerOption((o) =>
        o
          .setName('capacity')
          .setDescription('Maximum attendees')
          .setMinValue(1),
      )
      .addBooleanOption((o) =>
        o.setName('icons').setDescription('Show 🗓️ 🕐 📍 icons'),
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

function optional(interaction: CommandInteraction, name: string) {
  return interaction.options.getString(name) ?? undefined;
}

export function eventCommands(
  events: EventService,
  directory: Directory,
): Feature {
  const rsvp: ComponentHandler = {
    prefix: 'events:rsvp',
    execute: async (interaction, [id, answer]) => {
      const status = rsvpStatuses.find((s) => s === answer);
      const eventId = Number(id);

      if (
        !interaction.isButton() ||
        status === undefined ||
        !Number.isSafeInteger(eventId)
      ) {
        throw new UserError('This button is invalid.');
      }

      const view = await events.rsvp(
        toActor(interaction.member),
        eventId,
        status,
      );
      const { content, embeds, components } = render(view);

      await interaction.update({ content, embeds, components });
      await respond(interaction, `RSVP saved: **${rsvpLabels[status]}**.`);
    },
  };

  return {
    name: 'events',
    permissions: [
      { id: 'event:create', description: 'Create events' },
      { id: 'event:manage', description: 'Edit and cancel any event' },
    ],
    components: [rsvp],
    commands: [
      {
        data: data.toJSON(),
        permissions: { create: 'event:create' },
        execute: bySubcommand({
          create: deferred(async (interaction) => {
            const capacity = interaction.options.getInteger('capacity');
            const icons = interaction.options.getBoolean('icons');
            const mention = interaction.options.getRole('mention');
            const fields = [
              'description',
              'end',
              'location',
              'reminders',
            ] as const;
            const extras = Object.fromEntries(
              fields.flatMap((name) => {
                const value = optional(interaction, name);

                return value === undefined ? [] : [[name, value]];
              }),
            );
            const event = await events.create(toActor(interaction.member), {
              ...extras,
              title: interaction.options.getString('title', true),
              start: interaction.options.getString('start', true),
              channelId:
                interaction.options.getChannel('channel')?.id ??
                interaction.channelId,
              native: interaction.options.getBoolean('native') ?? false,
              ...(capacity !== null && { capacity }),
              ...(icons !== null && { icons }),
              ...(mention && { mentionRoleId: mention.id }),
            });

            await respond(
              interaction,
              `Created event #${event.id} in ${channelMention(event.channelId)}.`,
            );
          }),
          edit: deferred(async (interaction) => {
            const capacity = interaction.options.getInteger('capacity');
            const icons = interaction.options.getBoolean('icons');
            const fields = [
              'title',
              'start',
              'end',
              'description',
              'location',
            ] as const;
            const changes = Object.fromEntries(
              fields.flatMap((name) => {
                const value = optional(interaction, name);

                return value === undefined ? [] : [[name, value]];
              }),
            );
            const event = await events.edit(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
              {
                ...changes,
                ...(capacity !== null && { capacity }),
                ...(icons !== null && { icons }),
              },
            );

            await respond(interaction, `Event #${event.id} updated.`);
          }),
          cancel: deferred(async (interaction) => {
            const event = await events.cancel(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );

            await respond(interaction, `Event #${event.id} is cancelled.`);
          }),
          list: async (interaction) => {
            const upcoming = await visibleRecords(
              directory,
              toActor(interaction.member),
              await events.upcoming(interaction.guildId),
            );

            await respond(
              interaction,
              upcoming.length === 0
                ? 'No upcoming events.'
                : upcoming
                    .map(
                      (e) =>
                        `#${e.id} **${e.title}** - ${discordTime(e.startsAt, 'f')}`,
                    )
                    .join('\n'),
            );
          },
          view: async (interaction) => {
            const view = await events.view(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );

            await respondView(interaction, { ...view, controls: [] });
          },
          attendees: async (interaction) => {
            const { attendees } = await events.attendees(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );
            const section = (status: RsvpStatus) => {
              const ids = attendees
                .filter((a) => a.status === status)
                .map((a) => userMention(a.userId));

              return `**${rsvpLabels[status]} (${ids.length})**\n${ids.join(' ') || '-'}`;
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
        autocomplete: async (interaction) => {
          const upcoming = await visibleRecords(
            directory,
            toActor(interaction.member),
            await events.upcoming(interaction.guildId),
          );

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
}
