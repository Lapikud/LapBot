import { describe, expect, it, vi } from 'vitest';
import type { Calendar } from '~/core/ports/calendar';
import type { Scheduler } from '~/core/ports/scheduler';
import { createEventRepository } from '~/features/events/repository';
import { createEventService } from '~/features/events/service';
import { createMovieRepository } from '~/features/movies/repository';
import { createMovieService } from '~/features/movies/service';
import { createPollRepository } from '~/features/polls/repository';
import { createPollService } from '~/features/polls/service';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from '../../fakes';

describe.skipIf(noDatabase)('movie service', () => {
  const setup = () => {
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
      catalog: undefined,
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
});
