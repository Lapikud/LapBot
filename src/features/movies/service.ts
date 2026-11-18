import { maxOptionLength } from '~/features/polls/rules';
import { movieLabel, movieLinks, validateLinks } from './rules';
import { parseFutureWhen, parseWhen } from '~/core/helpers/time';
import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { type Authorizer } from '~/core/ports/authorization';
import { guard } from '~/core/helpers/authorization';
import type { MovieCatalog, MovieDetails } from '~/core/ports/movie-catalog';
import type { MovieRepository } from './model';
import type { EventService } from '~/features/events/service';
import type { PollService } from '~/features/polls/service';

const pollSource = 'movies';

export interface MovieNight {
  start: string;
  movieId?: number;
  location?: string;
  capacity?: number;
  channelId: string;
}

export interface MovieSuggestionRequest {
  title: string;
  year: number | null;
  note: string | null;
  links?: readonly string[];
}

interface Deps {
  movies: MovieRepository;
  catalog: MovieCatalog | undefined;
  polls: PollService;
  events: EventService;
  authz: Authorizer;
  timezone: string;
}

export function createMovieService(deps: Deps) {
  const { movies, polls, events, authz, timezone, catalog } = deps;

  const lookup = async (
    title: string,
    year: number | null,
  ): Promise<MovieDetails | null> =>
    catalog ? await catalog.lookup(title, year).catch(() => null) : null;

  const requireOwned = async (actor: Actor, id: number) => {
    const movie = await movies.find(actor.guildId, id);

    if (movie.suggestedBy !== actor.userId) {
      await authz.require(actor, 'movie:manage');
    }

    return movie;
  };

  const pick = async (actor: Actor, movieId: number | undefined) => {
    if (movieId !== undefined) {
      return { movie: await movies.find(actor.guildId, movieId), pollId: null };
    }

    const poll = await polls.latestBySource(actor.guildId, pollSource);

    if (poll?.status !== 'closed') {
      throw new UserError('Pick a movie, or close a "/movie vote" poll first.');
    }

    const { winners, tie } = await polls.results(poll);
    const [winner] = winners;

    if (winner === undefined) {
      throw new UserError('The last movie poll had no votes. Pick a movie.');
    }

    if (tie) {
      const tied = winners.map((w) => `#${w.ref ?? '?'} ${w.label}`).join(', ');

      throw new UserError(
        `The last poll is a tie between ${tied}. Pick one with the "movie" option.`,
      );
    }

    return {
      movie: await movies.find(actor.guildId, Number(winner.ref)),
      pollId: poll.id,
    };
  };

  return {
    pick,
    suggest: async (actor: Actor, request: MovieSuggestionRequest) => {
      const links = validateLinks(request.links ?? []);
      const details = await lookup(request.title, request.year);

      return movies.suggest({
        guildId: actor.guildId,
        suggestedBy: actor.userId,
        title: details?.title ?? request.title,
        year: details?.year ?? request.year,
        note: request.note,
        tmdbId: details?.tmdbId ?? null,
        overview: details?.overview ?? null,
        posterUrl: details?.posterUrl ?? null,
        trailerUrl: details?.trailerUrl ?? null,
        links,
      });
    },
    addLinks: async (actor: Actor, id: number, links: readonly string[]) => {
      const movie = await requireOwned(actor, id);
      const merged = validateLinks([...movie.links, ...links]);

      await movies.setLinks(movie.id, merged);

      return { ...movie, links: merged };
    },
    unwatched: (guildId: string, limit?: number) =>
      movies.unwatched(guildId, limit),
    history: (guildId: string) => movies.history(guildId),
    remove: async (actor: Actor, id: number) => {
      const movie = await requireOwned(actor, id);

      await movies.remove(movie.id);

      return movie;
    },
    vote: guard(
      authz,
      'movie:manage',
      async (
        actor,
        request: { count?: number; closes?: string; channelId: string },
      ) => {
        const candidates = await movies.unwatched(
          actor.guildId,
          request.count ?? 10,
        );

        if (candidates.length < 2) {
          throw new UserError(
            'At least two unwatched suggestions are needed for a vote.',
          );
        }

        const closesAt = parseFutureWhen(request.closes ?? '2d', timezone);

        return polls.publish(actor, {
          guildId: actor.guildId,
          channelId: request.channelId,
          creatorId: actor.userId,
          question: '🎬 What should we watch next?',
          options: candidates.map((m) => ({
            label: movieLabel(m).slice(0, maxOptionLength),
            ref: String(m.id),
            url: movieLinks(m)[0]?.url ?? null,
          })),
          closesAt,
          source: pollSource,
        });
      },
    ),
    night: guard(authz, 'movie:manage', async (actor, night: MovieNight) => {
      const { movie, pollId } = await pick(actor, night.movieId);
      const startsAt = parseFutureWhen(night.start, timezone);
      const event = await events.publish(actor, {
        guildId: actor.guildId,
        title: `🎬 Movie night: ${movieLabel(movie)}`.slice(0, 200),
        description:
          [
            movie.note,
            movie.overview?.slice(0, 900),
            movieLinks(movie)
              .map(({ label, url }) => `[${label}](${url})`)
              .join(' · '),
          ]
            .filter(Boolean)
            .join('\n\n') || null,
        startsAt,
        endsAt: null,
        timezone,
        location: night.location ?? null,
        organizerId: actor.userId,
        channelId: night.channelId,
        capacity: night.capacity ?? null,
        mentionRoleId: null,
        reminderMinutes: [60],
        icons: true,
      });

      await movies.recordScreening({
        guildId: actor.guildId,
        suggestionId: movie.id,
        eventId: event.id,
        pollId,
        scheduledFor: startsAt,
      });

      return { movie, event };
    }),
    watched: guard(
      authz,
      'movie:manage',
      async (actor, id: number, date?: string) => {
        const movie = await movies.find(actor.guildId, id);
        const at = date === undefined ? new Date() : parseWhen(date, timezone);

        await movies.markWatched(actor.guildId, movie.id, at);

        return movie;
      },
    ),
  };
}

export type MovieService = ReturnType<typeof createMovieService>;
