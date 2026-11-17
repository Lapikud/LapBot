import { describe, expect, it, vi } from 'vitest';
import type { Calendar } from '~/foundation/calendar';
import type { MovieCatalog } from '~/integrations/tmdb/contract';
import type { Scheduler } from '~/foundation/scheduler';
import { createEventService } from '~/features/events/service';
import { createMovieService } from './service';
import { createPollService } from '~/features/polls/service';
import { createEventRepository } from '~/features/events/repository';
import { createMovieRepository } from './repository';
import { createPollRepository } from '~/features/polls/repository';
import { noDatabase, snowflake, testDb } from '../../../tests/db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from '../../../tests/fakes';

describe.skipIf(noDatabase)('movie service', () => {
  const setup = (catalog?: MovieCatalog) => {
    const { messenger } = fakeMessenger();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const calendar = {
      upsert: vi.fn<Calendar['upsert']>(async () => 'n'),
      remove: vi.fn<Calendar['remove']>(async () => undefined),
    };
    const shared = {
      scheduler,
      messenger,
      directory: fakeDirectory(),
      authz: allowAll,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    };
    const pollRepository = createPollRepository(testDb());
    const polls = createPollService({ ...shared, polls: pollRepository });
    const events = createEventService({
      ...shared,
      events: createEventRepository(testDb()),
      calendar,
    });
    const movies = createMovieService({
      catalog,
      movies: createMovieRepository(testDb()),
      polls,
      events,
      authz: allowAll,
      timezone: shared.timezone,
    });

    return {
      movies,
      polls,
      pollRepository,
      messenger,
      member: actor({ guildId: snowflake(), userId: snowflake() }),
    };
  };

  const suggestion = (title: string) => ({ title, year: null, note: null });

  it('rejects duplicate suggestions and points out watched ones', async () => {
    const { movies, member } = setup();
    const movie = await movies.suggest(member, suggestion('Paprika'));

    await expect(
      movies.suggest(member, suggestion('paprika!')),
    ).rejects.toThrow('already suggested');
    await movies.watched(member, movie.id, '2026-01-02');
    await expect(movies.suggest(member, suggestion('Paprika'))).rejects.toThrow(
      'already watched (2026-01-',
    );
  });

  it('fills in details and the trailer from the catalog', async () => {
    const { movies, member } = setup({
      lookup: async () => ({
        tmdbId: 949,
        title: 'Heat',
        year: 1995,
        overview: 'A heist.',
        posterUrl: 'https://image.tmdb.org/t/p/w342/heat.jpg',
        trailerUrl: 'https://www.youtube.com/watch?v=abc',
      }),
    });
    const movie = await movies.suggest(member, suggestion('heat'));

    expect(movie).toMatchObject({
      title: 'Heat',
      year: 1995,
      tmdbId: 949,
      trailerUrl: 'https://www.youtube.com/watch?v=abc',
    });
  });

  it('still saves the suggestion when the catalog is down', async () => {
    const { movies, member } = setup({
      lookup: () => Promise.reject(new Error('timeout')),
    });

    expect((await movies.suggest(member, suggestion('Stalker'))).title).toBe(
      'Stalker',
    );
  });

  it('keeps only web links and lets the suggester add more', async () => {
    const { movies, member } = setup();

    await expect(
      movies.suggest(member, {
        ...suggestion('Solaris'),
        links: ['javascript:alert(1)'],
      }),
    ).rejects.toThrow('not a web link');

    const movie = await movies.suggest(member, {
      ...suggestion('Solaris'),
      links: ['https://letterboxd.com/film/solaris/'],
    });
    const updated = await movies.addLinks(member, movie.id, [
      'https://www.imdb.com/title/tt0069293/',
    ]);

    expect(updated.links).toHaveLength(2);
  });

  it('publishes movie links in ordered details before voting controls', async () => {
    const { movies, messenger, member } = setup();

    await movies.suggest(member, {
      ...suggestion('Papa John'),
      links: ['https://youtu.be/W7bSunrD4WY'],
    });
    await movies.suggest(member, suggestion('Plain'));

    const poll = await movies.vote(member, { channelId: 'c' });

    expect(poll.options.map((option) => option.url)).toEqual([
      'https://youtu.be/W7bSunrD4WY',
      null,
    ]);
    expect(messenger.send.mock.calls[0]?.[1].content).toContain(
      '[1. Papa John](<https://youtu.be/W7bSunrD4WY>)',
    );
    expect(messenger.send.mock.calls[0]?.[1].suppressEmbeds).toBe(true);
    expect(messenger.send.mock.calls[0]?.[1].controls).toBeUndefined();
    expect(messenger.send.mock.calls[1]?.[1].controls).toBeDefined();
  });

  it('votes through the poll service and refuses ties', async () => {
    const { movies, polls, pollRepository, member } = setup();

    await movies.suggest(member, suggestion('Alien'));
    await movies.suggest(member, suggestion('Brazil'));

    const poll = await movies.vote(member, { channelId: 'c' });
    const [alien, brazil] = poll.options.map((o) => o.id);

    await expect(movies.pick(member, undefined)).rejects.toThrow('close');
    await polls.vote(
      actor({ guildId: member.guildId, userId: snowflake() }),
      poll.id,
      [alien ?? 0],
    );
    await polls.vote(
      actor({ guildId: member.guildId, userId: snowflake() }),
      poll.id,
      [brazil ?? 0],
    );
    await pollRepository.finish(poll.id, 'closed');
    await expect(movies.pick(member, undefined)).rejects.toThrow('tie');
  });

  it('schedules a movie night through the event service and records history', async () => {
    const { movies, polls, pollRepository, member } = setup();

    await movies.suggest(member, suggestion('Heat'));
    await movies.suggest(member, suggestion('Ran'));

    const poll = await movies.vote(member, { channelId: 'c' });

    await polls.vote(
      actor({ guildId: member.guildId, userId: snowflake() }),
      poll.id,
      [poll.options[0]?.id ?? 0],
    );
    await pollRepository.finish(poll.id, 'closed');

    const { movie, event } = await movies.night(member, {
      start: '2d',
      channelId: 'c',
    });

    expect(movie.title).toBe('Heat');
    expect(event.title).toContain('Heat');
    await movies.watched(member, movie.id);
    expect((await movies.history(member.guildId)).map((h) => h.title)).toEqual([
      'Heat',
    ]);
    expect(
      (await movies.unwatched(member.guildId)).map((m) => m.title),
    ).toEqual(['Ran']);
  });
});
