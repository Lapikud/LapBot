import { describe, expect, it, vi } from 'vitest';
import { DiscordAPIError, RESTJSONErrorCodes, type Client } from 'discord.js';
import { UserError } from '~/core/errors';
import { createDiscordMessenger } from '~/integrations/discord/messenger';
import type { Scheduler } from '~/core/ports/scheduler';
import type { NewPoll } from '~/features/polls/model';
import { createPollRepository } from '~/integrations/db/polls/repository';
import { createPollService } from '~/features/polls/service';
import { noDatabase, snowflake, testDb } from './db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  silentLog,
} from './fakes';
import type { Calendar } from '~/core/ports/calendar';
import { createEventRepository } from '~/integrations/db/events/repository';
import { createEventService } from '~/features/events/service';
import { createMovieRepository } from '~/integrations/db/movies/repository';
import { createMovieService } from '~/features/movies/service';

describe('polls', () => {
  const base = (overrides: Partial<NewPoll> = {}): NewPoll => ({
    guildId: snowflake(),
    channelId: snowflake(),
    creatorId: snowflake(),
    question: 'Lunch?',
    options: [{ label: 'Pizza' }, { label: 'Sushi' }, { label: 'Tacos' }],
    ...overrides,
  });

  describe.skipIf(noDatabase)('poll repository', () => {
    const polls = () => createPollRepository(testDb());

    it('replaces a single-choice vote instead of adding another', async () => {
      const poll = await polls().insert(base());
      const [pizza, sushi] = poll.options.map((o) => o.id);
      const user = snowflake();

      await polls().vote(poll.id, user, [pizza ?? 0, pizza ?? 0]);
      expect(await polls().choices(poll.id, user)).toEqual([pizza]);
      await polls().vote(poll.id, user, [sushi ?? 0]);
      expect(await polls().choices(poll.id, user)).toEqual([sushi]);
      await expect(
        polls().vote(poll.id, user, [pizza ?? 0, sushi ?? 0]),
      ).rejects.toThrow('only one');
    });

    it('rejects options from another poll and votes after closing', async () => {
      const poll = await polls().insert(base());
      const other = await polls().insert(base());

      await expect(
        polls().vote(poll.id, snowflake(), [other.options[0]?.id ?? 0]),
      ).rejects.toThrow('not part');
      expect(await polls().finish(poll.id, 'closed')).toBeDefined();
      expect(await polls().finish(poll.id, 'closed')).toBeUndefined();
      await expect(
        polls().vote(poll.id, snowflake(), [poll.options[0]?.id ?? 0]),
      ).rejects.toBeInstanceOf(UserError);
    });

    it('keeps counts exact under concurrent voting', async () => {
      const poll = await polls().insert(base());
      const [pizza, sushi] = poll.options.map((o) => o.id);
      const user = snowflake();

      await Promise.all([
        ...Array.from({ length: 20 }, () =>
          polls().vote(poll.id, snowflake(), [pizza ?? 0]),
        ),
        ...Array.from({ length: 10 }, (_, n) =>
          polls().vote(poll.id, user, [(n % 2 === 0 ? pizza : sushi) ?? 0]),
        ),
      ]);
      expect((await polls().results(poll)).voters).toBe(21);
      expect(await polls().choices(poll.id, user)).toHaveLength(1);
    });
  });

  describe.skipIf(noDatabase)('poll service', () => {
    const setup = () => {
      const { messenger } = fakeMessenger();
      const scheduler = {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      };
      const repository = createPollRepository(testDb());
      const service = createPollService({
        polls: repository,
        scheduler,
        messenger,
        directory: fakeDirectory(),
        authz: allowAll,
        log: silentLog,
        timezone: 'Europe/Tallinn',
      });

      return {
        service,
        messenger,
        scheduler,
        repository,
        creator: actor({ guildId: snowflake(), userId: snowflake() }),
      };
    };

    it('publishes, schedules closing and hides live counts when asked', async () => {
      const { service, scheduler, creator } = setup();
      const poll = await service.create(creator, {
        question: 'Lunch?',
        options: ['Pizza', 'Sushi'],
        channelId: 'c',
        showResults: 'closed',
        closes: '1d',
      });

      expect(scheduler.schedule).toHaveBeenCalledOnce();

      const { view } = await service.vote(
        actor({ guildId: creator.guildId, userId: snowflake() }),
        poll.id,
        [poll.options[0]?.id ?? 0],
      );

      expect(view.content).not.toContain('▰');
    });

    it('hides voters of anonymous polls even from managers', async () => {
      const { service, creator } = setup();
      const poll = await service.create(creator, {
        question: 'Q',
        options: ['A', 'B'],
        channelId: 'c',
        anonymous: true,
      });

      await service.vote(
        actor({ guildId: creator.guildId, userId: snowflake() }),
        poll.id,
        [poll.options[0]?.id ?? 0],
      );
      expect((await service.summary(creator, poll.id)).voters).toBeUndefined();
    });
  });
});

describe('events', () => {
  const base = () => ({
    guildId: snowflake(),
    title: 'Board game night',
    description: null,
    startsAt: new Date(Date.now() + 3 * 3_600_000),
    endsAt: null,
    timezone: 'Europe/Tallinn',
    location: null,
    organizerId: snowflake(),
    channelId: snowflake(),
    capacity: null,
    mentionRoleId: null,
    reminderMinutes: [],
    icons: true,
  });

  describe.skipIf(noDatabase)('event RSVPs', () => {
    const repository = () => createEventRepository(testDb());

    it('records RSVPs and lets members change them without duplicates', async () => {
      const events = repository();
      const event = await events.insert(base());
      const user = snowflake();

      await events.setRsvp(event.id, user, 'going');
      await events.setRsvp(event.id, user, 'maybe');
      await events.setRsvp(event.id, user, 'maybe');
      expect(await events.attendees(event.id)).toEqual([
        { userId: user, status: 'maybe' },
      ]);
      expect(await events.counts(event.id)).toEqual({
        going: 0,
        maybe: 1,
        not_going: 0,
      });
    });

    it('enforces capacity but lets attendees keep their spot', async () => {
      const events = repository();
      const event = await events.insert({ ...base(), capacity: 1 });
      const [first, second] = [snowflake(), snowflake()];

      await events.setRsvp(event.id, first, 'going');
      await events.setRsvp(event.id, first, 'going');
      await expect(events.setRsvp(event.id, second, 'going')).rejects.toThrow(
        'full',
      );
      await events.setRsvp(event.id, first, 'not_going');
      await events.setRsvp(event.id, second, 'going');
      expect((await events.counts(event.id)).going).toBe(1);
    });

    it('never exceeds capacity under concurrent registrations', async () => {
      const events = repository();
      const event = await events.insert({ ...base(), capacity: 3 });
      const results = await Promise.allSettled(
        Array.from({ length: 15 }, () =>
          events.setRsvp(event.id, snowflake(), 'going'),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect((await events.counts(event.id)).going).toBe(3);
    });
  });

  describe.skipIf(noDatabase)('event service', () => {
    const setup = () => {
      const { messenger } = fakeMessenger();
      const scheduler = {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      };
      const calendar = {
        upsert: vi.fn<Calendar['upsert']>(async () => 'native'),
        remove: vi.fn<Calendar['remove']>(async () => undefined),
      };
      const directory = fakeDirectory();
      const service = createEventService({
        events: createEventRepository(testDb()),
        scheduler,
        messenger,
        calendar,
        directory,
        authz: allowAll,
        log: silentLog,
        timezone: 'Europe/Tallinn',
      });

      return {
        service,
        directory,
        messenger,
        scheduler,
        calendar,
        organizer: actor({ guildId: snowflake(), userId: snowflake() }),
      };
    };

    it('skips reminders for cancelled events and lets only organizers manage', async () => {
      const { service, messenger, organizer } = setup();
      const event = await service.create(organizer, {
        title: 'Quiz',
        start: '3h',
        channelId: 'c',
      });

      await service.cancel(organizer, event.id);
      messenger.send.mockClear();
      await service.jobs[0]?.run({ eventId: event.id, minutes: 60 });
      expect(messenger.send).not.toHaveBeenCalled();
    });

    it('rejects capacities that are not whole positive numbers', async () => {
      const { service, organizer } = setup();
      const event = await service.create(organizer, {
        title: 'Quiz',
        start: '3h',
        channelId: 'c',
        capacity: 5,
      });

      for (const capacity of [0, -3, 2.5, Number.NaN]) {
        await expect(
          service.edit(organizer, event.id, { capacity }),
        ).rejects.toBeInstanceOf(UserError);
        await expect(
          service.create(organizer, {
            title: 'Quiz',
            start: '3h',
            channelId: 'c',
            capacity,
          }),
        ).rejects.toBeInstanceOf(UserError);
      }

      expect((await service.get(organizer, event.id)).capacity).toBe(5);
    });

    it('clears nullable fields while leaving omitted changes unchanged', async () => {
      const { service, organizer } = setup();
      const event = await service.create(organizer, {
        title: 'Quiz',
        start: '3h',
        end: '4h',
        channelId: 'c',
        description: 'Details',
        location: 'Room',
        capacity: 5,
      });

      await service.edit(organizer, event.id, { title: 'New quiz' });
      expect(await service.get(organizer, event.id)).toMatchObject({
        description: 'Details',
        location: 'Room',
        capacity: 5,
        endsAt: event.endsAt,
      });
      await service.edit(organizer, event.id, {
        description: null,
        location: null,
        capacity: null,
        end: null,
      });
      expect(await service.get(organizer, event.id)).toMatchObject({
        title: 'New quiz',
        description: null,
        location: null,
        capacity: null,
        endsAt: null,
      });
    });

    it('denies direct reads and edits after channel visibility is lost', async () => {
      const { service, organizer, directory } = setup();
      const event = await service.create(organizer, {
        title: 'Secret',
        start: '3h',
        channelId: 'private',
      });

      directory.canView.mockResolvedValue(false);
      await expect(service.get(organizer, event.id)).rejects.toThrow(
        'does not exist',
      );
      await expect(service.view(organizer, event.id)).rejects.toThrow(
        'does not exist',
      );
      await expect(
        service.edit(organizer, event.id, { title: 'Changed' }),
      ).rejects.toThrow('does not exist');
    });
  });
});

describe('movies', () => {
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
      await expect(
        movies.suggest(member, suggestion('Paprika')),
      ).rejects.toThrow('already watched (2026-01-');
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
});

describe('deleted Discord messages', () => {
  it('treats a deleted channel as a missing message', async () => {
    const gone = new DiscordAPIError(
      { code: RESTJSONErrorCodes.UnknownChannel, message: 'Unknown Channel' },
      RESTJSONErrorCodes.UnknownChannel,
      404,
      'GET',
      '/channels/c',
      {},
    );
    const client = {
      channels: {
        fetch: async () => {
          throw gone;
        },
      },
    } as unknown as Client;
    const messenger = createDiscordMessenger(client);

    expect(await messenger.edit('c', 'm', { content: 'x' })).toBe(false);
    expect(await messenger.remove('c', 'm')).toBe(false);
    expect(await messenger.exists('c', 'm')).toBe(false);
  });
});
