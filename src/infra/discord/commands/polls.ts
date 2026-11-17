import type { Directory } from '~/core/ports';
import { visibleRecords } from '~/core/authorization';
import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { describeOutcome, type PollService } from '~/core/polls';
import { channelMention, userMention, UserError } from '~/domain';
import { toActor } from '../actor';
import { bySubcommand, deferred } from '../define';
import type { ComponentHandler, Feature } from '../module';
import { render } from '../render';
import { respond } from '../router';

const idOption = (o: SlashCommandIntegerOption) =>
  o
    .setName('id')
    .setDescription('Poll')
    .setRequired(true)
    .setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Polls')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Start a poll')
      .addStringOption((o) =>
        o
          .setName('question')
          .setDescription('Question')
          .setRequired(true)
          .setMaxLength(256),
      )
      .addStringOption((o) =>
        o
          .setName('options')
          .setDescription('Options separated by | e.g. "Pizza | Sushi | Tacos"')
          .setRequired(true),
      )
      .addBooleanOption((o) =>
        o.setName('multiple').setDescription('Allow several choices'),
      )
      .addBooleanOption((o) =>
        o.setName('anonymous').setDescription('Hide who voted for what'),
      )
      .addStringOption((o) =>
        o
          .setName('results')
          .setDescription('When results are visible')
          .addChoices(
            { name: 'live', value: 'live' },
            { name: 'after closing', value: 'closed' },
          ),
      )
      .addStringOption((o) =>
        o.setName('closes').setDescription('e.g. 2h, 1d, fri 18:00'),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('Open polls'))
  .addSubcommand((sub) =>
    sub
      .setName('results')
      .setDescription('Show results')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Close a poll now')
      .addIntegerOption(idOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel a poll')
      .addIntegerOption(idOption),
  );

function parseId(value: string | undefined): number {
  const id = Number(value);

  if (!Number.isSafeInteger(id)) {
    throw new UserError('This poll control is invalid.');
  }

  return id;
}

export function pollCommands(
  polls: PollService,
  directory: Directory,
): Feature {
  const answer = async (
    interaction: Parameters<ComponentHandler['execute']>[0],
    outcome: Awaited<ReturnType<PollService['vote']>>,
  ) => {
    if (interaction.isModalSubmit()) {
      return;
    }

    const { content, embeds, components } = render(outcome.view);

    await interaction.update({ content, embeds, components });
    await respond(
      interaction,
      outcome.chosen.length === 0
        ? 'Your vote is cleared.'
        : `Your vote: **${outcome.chosen.join(', ')}**`,
    );
  };

  const vote: ComponentHandler = {
    prefix: 'polls:vote',
    execute: async (interaction, [id]) => {
      if (!interaction.isStringSelectMenu()) {
        return;
      }

      await answer(
        interaction,
        await polls.vote(
          toActor(interaction.member),
          parseId(id),
          interaction.values.map((value) => Number(value)),
        ),
      );
    },
  };

  const clear: ComponentHandler = {
    prefix: 'polls:clear',
    execute: async (interaction, [id]) => {
      await answer(
        interaction,
        await polls.clear(toActor(interaction.member), parseId(id)),
      );
    },
  };

  return {
    name: 'polls',
    permissions: [
      { id: 'poll:create', description: 'Start polls' },
      {
        id: 'poll:manage',
        description: 'Close and cancel any poll, see voters',
      },
    ],
    components: [vote, clear],
    commands: [
      {
        data: data.toJSON(),
        permissions: { create: 'poll:create' },
        execute: bySubcommand({
          create: deferred(async (interaction) => {
            const closes = interaction.options.getString('closes');
            const poll = await polls.create(toActor(interaction.member), {
              question: interaction.options.getString('question', true),
              options: interaction.options
                .getString('options', true)
                .split('|'),
              channelId:
                interaction.options.getChannel('channel')?.id ??
                interaction.channelId,
              multiple: interaction.options.getBoolean('multiple') ?? false,
              anonymous: interaction.options.getBoolean('anonymous') ?? false,
              showResults:
                interaction.options.getString('results') === 'closed'
                  ? 'closed'
                  : 'live',
              ...(closes !== null && { closes }),
            });

            await respond(
              interaction,
              `Poll #${poll.id} is up in ${channelMention(poll.channelId)}.`,
            );
          }),
          list: async (interaction) => {
            const open = await visibleRecords(
              directory,
              toActor(interaction.member),
              await polls.open(interaction.guildId),
            );

            await respond(
              interaction,
              open.length === 0
                ? 'No open polls.'
                : open
                    .map(
                      (p) =>
                        `#${p.id} ${p.question} — ${channelMention(p.channelId)}`,
                    )
                    .join('\n'),
            );
          },
          results: async (interaction) => {
            const { poll, results, voters } = await polls.summary(
              toActor(interaction.member),
              interaction.options.getInteger('id', true),
            );
            const lines = results.options.map((option) => {
              const names =
                voters?.get(option.id)?.map((id) => userMention(id)) ?? [];

              return [`**${option.label}** — ${option.votes}`, ...names].join(
                ' ',
              );
            });
            const winner =
              results.winners.length === 0
                ? 'No votes yet.'
                : describeOutcome(results, 'Leading');

            await respond(
              interaction,
              [`# ${poll.question}`, ...lines, winner]
                .join('\n')
                .slice(0, 2000),
            );
          },
          close: deferred(async (interaction) => {
            const id = interaction.options.getInteger('id', true);

            await polls.close(toActor(interaction.member), id);
            await respond(interaction, `Poll #${id} is closed.`);
          }),
          cancel: deferred(async (interaction) => {
            const id = interaction.options.getInteger('id', true);

            await polls.cancel(toActor(interaction.member), id);
            await respond(interaction, `Poll #${id} is cancelled.`);
          }),
        }),
        autocomplete: async (interaction) => {
          const open = await visibleRecords(
            directory,
            toActor(interaction.member),
            await polls.open(interaction.guildId),
          );

          await interaction.respond(
            open.map((p) => ({
              name: `#${p.id} ${p.question}`.slice(0, 100),
              value: p.id,
            })),
          );
        },
      },
    ],
  };
}
