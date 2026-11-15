import { describe, expect, it, vi } from 'vitest';
import type { Calendar, Scheduler } from '~/core/ports';
import {
  createEventService,
  createMovieService,
  createPollService,
} from '~/core/services';
import {
  createEventRepository,
  createMovieRepository,
  createPollRepository,
} from '~/infra/db';
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
      timezone: async () => 'Europe/Tallinn',
    };
    const pollRepository = createPollRepository(testDb());
    const polls = createPollService({ ...shared, polls: pollRepository });
    const events = createEventService({
      ...shared,
      events: createEventRepository(testDb()),
      calendar,
    });
    const movies = createMovieService({
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
