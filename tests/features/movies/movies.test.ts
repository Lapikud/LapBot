import { describe, expect, it } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { AppContext } from '~/core/feature';
import { castVote, finishPoll, insertPoll } from '~/features/polls/service';
import { pickMovie } from '~/features/movies';
import {
  listUnwatched,
  markWatched,
  normalizeTitle,
  recordScreening,
  suggestMovie,
  watchHistory,
} from '~/features/movies/service';

describe('normalizeTitle', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeTitle('The Matrix!')).toBe(
      normalizeTitle('  the   MATRIX '),
    );
    expect(normalizeTitle('Amélie')).toBe(normalizeTitle('amélie'));
  });
});

describe.skipIf(noDatabase)('movies', () => {
  const ctx = () => ({ db: testDb() }) as unknown as AppContext;
  const suggest = (guildId: string, title: string) =>
    suggestMovie(testDb(), {
      guildId,
      title,
      year: null,
      note: null,
      suggestedBy: snowflake(),
    });

  it('rejects duplicate suggestions and points out watched ones', async () => {
    const guildId = snowflake();
    const movie = await suggest(guildId, 'Paprika');

    await expect(suggest(guildId, 'paprika!')).rejects.toThrow(
      'already suggested',
    );
    await markWatched(
      testDb(),
      guildId,
      movie.id,
      new Date('2026-01-02T20:00:00Z'),
    );
    await expect(suggest(guildId, 'Paprika')).rejects.toThrow(
      'already watched (2026-01-02)',
    );
    expect(await suggest(snowflake(), 'Paprika')).toBeDefined();
  });

  it('picks the winner of the latest movie poll and refuses ties', async () => {
    const guildId = snowflake();
    const [a, b] = [
      await suggest(guildId, 'Alien'),
      await suggest(guildId, 'Brazil'),
    ];
    const poll = await insertPoll(testDb(), {
      guildId,
      channelId: snowflake(),
      creatorId: snowflake(),
      question: 'Next?',
      source: 'movies',
      options: [a, b].map((m) => ({ label: m.title, ref: String(m.id) })),
    });

    await expect(pickMovie(ctx(), guildId, null)).rejects.toThrow('close');

    const [optionA, optionB] = poll.options.map((o) => o.id);

    await castVote(testDb(), poll.id, snowflake(), [optionA ?? 0]);
    await castVote(testDb(), poll.id, snowflake(), [optionB ?? 0]);
    await finishPoll(testDb(), poll.id, 'closed');
    await expect(pickMovie(ctx(), guildId, null)).rejects.toThrow('tie');
    expect((await pickMovie(ctx(), guildId, b.id)).movie.title).toBe('Brazil');

    const second = await insertPoll(testDb(), {
      guildId,
      channelId: snowflake(),
      creatorId: snowflake(),
      question: 'Again?',
      source: 'movies',
      options: [a, b].map((m) => ({ label: m.title, ref: String(m.id) })),
    });

    await castVote(testDb(), second.id, snowflake(), [
      second.options[0]?.id ?? 0,
    ]);
    await finishPoll(testDb(), second.id, 'closed');
    expect(await pickMovie(ctx(), guildId, null)).toMatchObject({
      movie: { title: 'Alien' },
      pollId: second.id,
    });
  });

  it('tracks screenings and history', async () => {
    const guildId = snowflake();
    const movie = await suggest(guildId, 'Heat');

    await recordScreening(testDb(), {
      guildId,
      suggestionId: movie.id,
      eventId: 1,
      scheduledFor: new Date(),
    });
    expect((await listUnwatched(testDb(), guildId)).map((m) => m.id)).toEqual([
      movie.id,
    ]);
    await markWatched(testDb(), guildId, movie.id, new Date());
    expect(await listUnwatched(testDb(), guildId)).toEqual([]);
    expect((await watchHistory(testDb(), guildId)).map((h) => h.title)).toEqual(
      ['Heat'],
    );
  });
});
