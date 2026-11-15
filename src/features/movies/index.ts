import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { respond, bySubcommand } from '~/infra/discord';
import type { AppContext, CommandInteraction, Feature } from '~/infra/discord';
import { getGuildTimezone } from '~/infra/db';
import { UserError, discordTime, parseFutureWhen, parseWhen } from '~/domain';
import { createEvent } from '~/features/events';
import { createPoll, getResults, latestPollBySource } from '~/features/polls';
import type { MovieSuggestion } from './schema';
import {
  listUnwatched,
  markWatched,
  recordScreening,
  removeSuggestion,
  requireSuggestion,
  suggestMovie,
  watchHistory,
} from './service';

const pollSource = 'movies';

const label = (movie: Pick<MovieSuggestion, 'title' | 'year'>) =>
  movie.year === null ? movie.title : `${movie.title} (${movie.year})`;

export async function pickMovie(
  ctx: AppContext,
  guildId: string,
  movieId: number | null,
) {
  if (movieId !== null) {
    return {
      movie: await requireSuggestion(ctx.db, guildId, movieId),
      pollId: null,
    };
  }

  const poll = await latestPollBySource(ctx.db, guildId, pollSource);

  if (poll?.status !== 'closed') {
    throw new UserError('Pick a movie, or close a `/movie vote` poll first.');
  }

  const { winners, tie } = await getResults(ctx.db, poll);

  if (winners.length === 0) {
    throw new UserError('The last movie poll had no votes. Pick a movie.');
  }

  if (tie) {
    const tied = winners.map((w) => `#${w.ref ?? '?'} ${w.label}`).join(', ');

    throw new UserError(
      `The last poll is a tie between ${tied}. Pick one with the \`movie\` option.`,
    );
  }

  const winner = winners[0];

  return {
    movie: await requireSuggestion(ctx.db, guildId, Number(winner?.ref)),
    pollId: poll.id,
  };
}

const movieOption = (o: SlashCommandIntegerOption) =>
  o.setName('movie').setDescription('Movie').setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('movie')
  .setDescription('Movie suggestions and movie nights')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('suggest')
      .setDescription('Suggest a movie')
      .addStringOption((o) =>
        o
          .setName('title')
          .setDescription('Title')
          .setRequired(true)
          .setMaxLength(200),
      )
      .addIntegerOption((o) =>
        o
          .setName('year')
          .setDescription('Release year')
          .setMinValue(1880)
          .setMaxValue(2100),
      )
      .addStringOption((o) =>
        o.setName('note').setDescription('Why watch it?').setMaxLength(300),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('suggestions').setDescription('Movies waiting to be watched'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a suggestion')
      .addIntegerOption((o) => movieOption(o).setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('vote')
      .setDescription('Start a poll over the suggestions')
      .addIntegerOption((o) =>
        o
          .setName('count')
          .setDescription('How many movies (default 10)')
          .setMinValue(2)
          .setMaxValue(25),
      )
      .addStringOption((o) =>
        o.setName('closes').setDescription('When voting ends (default 2d)'),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('night')
      .setDescription(
        'Schedule a movie night (defaults to the last poll winner)',
      )
      .addStringOption((o) =>
        o
          .setName('start')
          .setDescription('e.g. 2026-11-20 19:00')
          .setRequired(true),
      )
      .addIntegerOption(movieOption)
      .addStringOption((o) =>
        o.setName('location').setDescription('Where').setMaxLength(200),
      )
      .addIntegerOption((o) =>
        o.setName('capacity').setDescription('Seats').setMinValue(1),
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Where to post (default: here)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('watched')
      .setDescription('Mark a movie as watched')
      .addIntegerOption((o) => movieOption(o).setRequired(true))
      .addStringOption((o) =>
        o.setName('date').setDescription('When (default: now)'),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('history').setDescription('Movies we have watched'),
  );

const zoneOf = (interaction: CommandInteraction, ctx: AppContext) =>
  getGuildTimezone(ctx.db, interaction.guildId, ctx.config.DEFAULT_TIMEZONE);

export const moviesFeature: Feature = {
  name: 'movies',
  permissions: [
    {
      id: 'movie:manage',
      description: 'Run movie votes and movie nights, remove suggestions',
    },
  ],
  commands: [
    {
      data: data.toJSON(),
      permissions: {
        vote: 'movie:manage',
        night: 'movie:manage',
        watched: 'movie:manage',
      },
      execute: bySubcommand({
        suggest: async (interaction, ctx) => {
          const movie = await suggestMovie(ctx.db, {
            guildId: interaction.guildId,
            title: interaction.options.getString('title', true),
            year: interaction.options.getInteger('year'),
            note: interaction.options.getString('note'),
            suggestedBy: interaction.user.id,
          });

          await respond(
            interaction,
            `Added #${movie.id} ${label(movie)} to the list.`,
          );
        },
        suggestions: async (interaction, ctx) => {
          const movies = await listUnwatched(ctx.db, interaction.guildId);

          await respond(
            interaction,
            movies.length === 0
              ? 'No suggestions yet. Add one with `/movie suggest`.'
              : movies
                  .map((m) => `#${m.id} ${label(m)} — <@${m.suggestedBy}>`)
                  .join('\n'),
          );
        },
        remove: async (interaction, ctx) => {
          const movie = await requireSuggestion(
            ctx.db,
            interaction.guildId,
            interaction.options.getInteger('movie', true),
          );

          if (movie.suggestedBy !== interaction.user.id) {
            await ctx.authz.require(interaction.member, 'movie:manage');
          }

          await removeSuggestion(ctx.db, movie.id);
          await respond(interaction, `Removed ${label(movie)}.`);
        },
        vote: async (interaction, ctx) => {
          const movies = await listUnwatched(
            ctx.db,
            interaction.guildId,
            interaction.options.getInteger('count') ?? 10,
          );

          if (movies.length < 2) {
            throw new UserError(
              'At least two unwatched suggestions are needed for a vote.',
            );
          }

          const closesAt = parseFutureWhen(
            interaction.options.getString('closes') ?? '2d',
            await zoneOf(interaction, ctx),
          );

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const poll = await createPoll(ctx, {
            guildId: interaction.guildId,
            channelId:
              interaction.options.getChannel('channel')?.id ??
              interaction.channelId,
            creatorId: interaction.user.id,
            question: '🎬 What should we watch next?',
            options: movies.map((m) => ({
              label: label(m).slice(0, 100),
              ref: String(m.id),
            })),
            closesAt,
            source: pollSource,
          });

          await interaction.editReply(
            `Movie poll #${poll.id} closes ${discordTime(closesAt, 'R')}.`,
          );
        },
        night: async (interaction, ctx) => {
          const { movie, pollId } = await pickMovie(
            ctx,
            interaction.guildId,
            interaction.options.getInteger('movie'),
          );
          const timezone = await zoneOf(interaction, ctx);
          const startsAt = parseFutureWhen(
            interaction.options.getString('start', true),
            timezone,
          );

          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const event = await createEvent(ctx, {
            guildId: interaction.guildId,
            title: `🎬 Movie night: ${label(movie)}`.slice(0, 200),
            description: movie.note,
            startsAt,
            timezone,
            location: interaction.options.getString('location'),
            organizerId: interaction.user.id,
            channelId:
              interaction.options.getChannel('channel')?.id ??
              interaction.channelId,
            capacity: interaction.options.getInteger('capacity'),
            reminderMinutes: [60],
          });

          await recordScreening(ctx.db, {
            guildId: interaction.guildId,
            suggestionId: movie.id,
            eventId: event.id,
            pollId,
            scheduledFor: startsAt,
          });
          await interaction.editReply(
            `Movie night for ${label(movie)} is event #${event.id}.`,
          );
        },
        watched: async (interaction, ctx) => {
          const movie = await requireSuggestion(
            ctx.db,
            interaction.guildId,
            interaction.options.getInteger('movie', true),
          );
          const date = interaction.options.getString('date');
          const watchedAt =
            date === null
              ? new Date()
              : parseWhen(date, await zoneOf(interaction, ctx));

          await markWatched(ctx.db, interaction.guildId, movie.id, watchedAt);
          await respond(interaction, `Marked ${label(movie)} as watched.`);
        },
        history: async (interaction, ctx) => {
          const history = await watchHistory(ctx.db, interaction.guildId);

          await respond(
            interaction,
            history.length === 0
              ? 'No movies watched yet.'
              : history
                  .map(
                    (h) =>
                      `${h.watchedAt ? discordTime(h.watchedAt, 'D') : ''} ${label(h)}`,
                  )
                  .join('\n'),
          );
        },
      }),
      autocomplete: async (interaction, ctx) => {
        const query = interaction.options.getFocused().toLowerCase();
        const movies = await listUnwatched(ctx.db, interaction.guildId);

        await interaction.respond(
          movies
            .filter((m) => m.title.toLowerCase().includes(query))
            .map((m) => ({
              name: `#${m.id} ${label(m)}`.slice(0, 100),
              value: m.id,
            })),
        );
      },
    },
  ],
};
