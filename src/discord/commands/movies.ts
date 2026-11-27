import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
} from 'discord.js';
import type { MovieService } from '~/features/movies/service';
import { discordTime } from '~/core/helpers/time';
import { userMention } from '~/core/message';
import { maxPollOptions } from '~/features/polls/rules';
import {
  movieLabel,
  movieLinks,
  type MovieLink,
} from '~/features/movies/rules';
import { toActor } from '~/discord/interactions/actor';
import { bySubcommand, deferred } from './handlers';
import type { Feature } from '~/discord/contracts';
import { respond } from '~/discord/interactions/responses';

const linkLine = (links: readonly MovieLink[]) =>
  links.map(({ label, url }) => `[${label}](${url})`).join(' · ');

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
      )
      .addStringOption((o) =>
        o
          .setName('link')
          .setDescription('A link, e.g. Letterboxd or a trailer')
          .setMaxLength(300),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('link')
      .setDescription('Add a link to a suggestion')
      .addIntegerOption((o) => movieOption(o).setRequired(true))
      .addStringOption((o) =>
        o
          .setName('url')
          .setDescription('e.g. Letterboxd, IMDb or a trailer')
          .setRequired(true)
          .setMaxLength(300),
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
          .setMaxValue(maxPollOptions),
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
        'Schedule a movie night (without a movie, people vote on one)',
      )
      .addStringOption((o) =>
        o
          .setName('start')
          .setDescription('e.g. fri 19:00 or 20.11 19:00')
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

export function movieCommands(movies: MovieService): Feature {
  return {
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
        execute: bySubcommand({
          suggest: deferred(async (interaction) => {
            const link = interaction.options.getString('link');
            const movie = await movies.suggest(toActor(interaction.member), {
              title: interaction.options.getString('title', true),
              year: interaction.options.getInteger('year'),
              note: interaction.options.getString('note'),
              links: link === null ? [] : [link],
            });

            await respond(
              interaction,
              `Added #${movie.id} ${movieLabel(movie)} to the list. ${linkLine(movieLinks(movie))}`,
            );
          }),
          link: async (interaction) => {
            const movie = await movies.addLinks(
              toActor(interaction.member),
              interaction.options.getInteger('movie', true),
              [interaction.options.getString('url', true)],
            );

            await respond(
              interaction,
              `${movieLabel(movie)}: ${linkLine(movieLinks(movie))}`,
            );
          },
          suggestions: async (interaction) => {
            const list = await movies.unwatched(interaction.guildId);

            await respond(
              interaction,
              list.length === 0
                ? 'No suggestions yet. Add one with "/movie suggest".'
                : list
                    .map((m) =>
                      [
                        `#${m.id} **${movieLabel(m)}** - ${userMention(m.suggestedBy)}`,
                        linkLine(movieLinks(m)),
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    )
                    .join('\n')
                    .slice(0, 2000),
            );
          },
          remove: async (interaction) => {
            const movie = await movies.remove(
              toActor(interaction.member),
              interaction.options.getInteger('movie', true),
            );

            await respond(interaction, `Removed ${movieLabel(movie)}.`);
          },
          vote: deferred(async (interaction) => {
            const count = interaction.options.getInteger('count');
            const closes = interaction.options.getString('closes');
            const poll = await movies.vote(toActor(interaction.member), {
              channelId:
                interaction.options.getChannel('channel')?.id ??
                interaction.channelId,
              ...(count !== null && { count }),
              ...(closes !== null && { closes }),
            });

            await respond(
              interaction,
              `Movie poll #${poll.id} closes ${discordTime(poll.closesAt ?? new Date(), 'R')}.`,
            );
          }),
          night: deferred(async (interaction) => {
            const movieId = interaction.options.getInteger('movie');
            const location = interaction.options.getString('location');
            const capacity = interaction.options.getInteger('capacity');
            const { movie, event } = await movies.night(
              toActor(interaction.member),
              {
                start: interaction.options.getString('start', true),
                channelId:
                  interaction.options.getChannel('channel')?.id ??
                  interaction.channelId,
                ...(movieId !== null && { movieId }),
                ...(location !== null && { location }),
                ...(capacity !== null && { capacity }),
              },
            );

            await respond(
              interaction,
              movie === undefined
                ? `Movie night is event #${event.id}, with a vote on the movie.`
                : `Movie night for ${movieLabel(movie)} is event #${event.id}.`,
            );
          }),
          watched: async (interaction) => {
            const date = interaction.options.getString('date');
            const movie = await movies.watched(
              toActor(interaction.member),
              interaction.options.getInteger('movie', true),
              ...(date === null ? [] : [date]),
            );

            await respond(
              interaction,
              `Marked ${movieLabel(movie)} as watched.`,
            );
          },
          history: async (interaction) => {
            const history = await movies.history(interaction.guildId);

            await respond(
              interaction,
              history.length === 0
                ? 'No movies watched yet.'
                : history
                    .map(
                      (h) =>
                        `${h.watchedAt ? discordTime(h.watchedAt, 'D') : ''} ${movieLabel(h)}`,
                    )
                    .join('\n'),
            );
          },
        }),
        autocomplete: async (interaction) => {
          const query = interaction.options.getFocused().toLowerCase();
          const list = await movies.unwatched(interaction.guildId);

          await interaction.respond(
            list
              .filter((m) => m.title.toLowerCase().includes(query))
              .map((m) => ({
                name: `#${m.id} ${movieLabel(m)}`.slice(0, 100),
                value: m.id,
              })),
          );
        },
      },
    ],
  };
}
