import { maxOptionLength } from '~/features/polls/rules';
import { movieLabel, movieLinks, validateLinks } from './rules';
import { parseFutureWhen, parseWhen } from '~/core/helpers/time';
import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { type Authorizer } from '~/core/ports/authorization';
import { guard } from '~/core/helpers/authorization';
import type { MovieCatalog, MovieDetails } from '~/core/ports/movie-catalog';
import type { MovieRepository, MovieSuggestion } from './model';
import type { EventService } from '~/features/events/service';
import type { PollService } from '~/features/polls/service';

const pollSource = 'movies';

export interface MovieNight {
  start: string;
  movieId?: number;
  location?: string;
  capacity?: number;
  channelId: string;
  closes?: string;
  count?: number;
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

  const nightDetails = (movie: MovieSuggestion) => ({
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
  });

  const moviePoll = async (
    actor: Actor,
    channelId: string,
    count: number | undefined,
    closesAt: Date,
  ) => {
    const candidates = await movies.unwatched(actor.guildId, count ?? 10);

    if (candidates.length < 2) {
      throw new UserError(
        'At least two unwatched suggestions are needed for a vote.',
      );
    }

    return {
      guildId: actor.guildId,
      channelId,
      creatorId: actor.userId,
      question: '🎬 What should we watch next?',
      options: candidates.map((m) => ({
        label: movieLabel(m).slice(0, maxOptionLength),
        ref: String(m.id),
        url: movieLinks(m)[0]?.url ?? null,
      })),
      closesAt,
      source: pollSource,
    };
  };

  polls.onClosed(async (poll, results) => {
    const event = await events.byPoll(poll.id);
    const [winner] = results.winners;

    if (
      poll.source !== pollSource ||
      event?.status !== 'scheduled' ||
      winner === undefined ||
      results.tie
    ) {
      return;
    }

    const movie = await movies.find(poll.guildId, Number(winner.ref));

    await events.decide(event.id, nightDetails(movie));
    await movies.recordScreening({
      guildId: poll.guildId,
      suggestionId: movie.id,
      eventId: event.id,
      pollId: poll.id,
      scheduledFor: event.startsAt,
    });
  });

  return {
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
      ) =>
        polls.publish(
          actor,
          await moviePoll(
            actor,
            request.channelId,
            request.count,
            parseFutureWhen(request.closes ?? '2d', timezone),
          ),
        ),
    ),
    night: guard(authz, 'movie:manage', async (actor, night: MovieNight) => {
      const startsAt = parseFutureWhen(night.start, timezone);
      const event = {
        guildId: actor.guildId,
        startsAt,
        endsAt: null,
        timezone,
        location: night.location ?? null,
        organizerId: actor.userId,
        channelId: night.channelId,
        capacity: night.capacity ?? null,
        mentions: {},
        reminderMinutes: [60],
        icons: true,
      };

      if (night.movieId !== undefined) {
        const movie = await movies.find(actor.guildId, night.movieId);
        const posted = await events.publish(actor, {
          ...event,
          ...nightDetails(movie),
        });

        await movies.recordScreening({
          guildId: actor.guildId,
          suggestionId: movie.id,
          eventId: posted.id,
          pollId: null,
          scheduledFor: startsAt,
        });

        return { movie, event: posted };
      }

      const poll = await moviePoll(
        actor,
        night.channelId,
        night.count,
        night.closes === undefined
          ? startsAt
          : parseFutureWhen(night.closes, timezone),
      );
      const posted = await events.publish(actor, {
        ...event,
        title: '🎬 Movie night',
        description: 'Vote below on what we watch.',
      });
      const { id } = await polls.publish(actor, poll);

      return {
        movie: undefined,
        event: await events.attachPoll(posted.id, id),
      };
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
