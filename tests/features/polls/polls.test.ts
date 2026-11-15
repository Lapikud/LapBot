import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { AppContext } from '~/core/feature';
import { UserError } from '~/shared/errors';
import { closeJob, renderPoll } from '~/features/polls';
import {
  castVote,
  finishPoll,
  getPoll,
  getResults,
  getVoterChoices,
  insertPoll,
  type NewPoll,
} from '~/features/polls/service';

const base = (overrides: Partial<NewPoll> = {}): NewPoll => ({
  guildId: snowflake(),
  channelId: snowflake(),
  creatorId: snowflake(),
  question: 'Lunch?',
  options: [{ label: 'Pizza' }, { label: 'Sushi' }, { label: 'Tacos' }],
  ...overrides,
});

describe.skipIf(noDatabase)('polls', () => {
  const db = () => testDb();

  it('validates options', async () => {
    await expect(
      insertPoll(db(), base({ options: [{ label: 'Only' }] })),
    ).rejects.toThrow('between 2');
    await expect(
      insertPoll(db(), base({ options: [{ label: 'A' }, { label: 'a' }] })),
    ).rejects.toThrow('distinct');
  });

  it('replaces a single-choice vote instead of adding another', async () => {
    const poll = await insertPoll(db(), base());
    const [pizza, sushi] = poll.options;
    const user = snowflake();

    await castVote(db(), poll.id, user, [pizza?.id ?? 0]);
    await castVote(db(), poll.id, user, [sushi?.id ?? 0]);
    expect(await getVoterChoices(db(), poll.id, user)).toEqual([sushi?.id]);
    await expect(
      castVote(db(), poll.id, user, [pizza?.id ?? 0, sushi?.id ?? 0]),
    ).rejects.toThrow('only one');
  });

  it('accepts several choices in multiple-choice polls and clearing', async () => {
    const poll = await insertPoll(db(), base({ multiple: true }));
    const ids = poll.options.map((o) => o.id);
    const user = snowflake();

    await castVote(db(), poll.id, user, ids);
    expect((await getResults(db(), poll)).voters).toBe(1);
    expect((await getResults(db(), poll)).options.map((o) => o.votes)).toEqual([
      1, 1, 1,
    ]);
    await castVote(db(), poll.id, user, []);
    expect((await getResults(db(), poll)).voters).toBe(0);
  });

  it('rejects options from another poll', async () => {
    const poll = await insertPoll(db(), base());
    const other = await insertPoll(db(), base());

    await expect(
      castVote(db(), poll.id, snowflake(), [other.options[0]?.id ?? 0]),
    ).rejects.toThrow('not part');
  });

  it('reports ties and winners', async () => {
    const poll = await insertPoll(db(), base());
    const [pizza, sushi] = poll.options.map((o) => o.id);

    await castVote(db(), poll.id, snowflake(), [pizza ?? 0]);
    await castVote(db(), poll.id, snowflake(), [sushi ?? 0]);
    const tied = await getResults(db(), poll);

    expect(tied.tie).toBe(true);
    expect(tied.winners.map((w) => w.label)).toEqual(['Pizza', 'Sushi']);
    await castVote(db(), poll.id, snowflake(), [sushi ?? 0]);
    const won = await getResults(db(), poll);

    expect(won.tie).toBe(false);
    expect(won.winners.map((w) => w.label)).toEqual(['Sushi']);
  });

  it('refuses votes after closing or the deadline', async () => {
    const poll = await insertPoll(db(), base());

    expect(await finishPoll(db(), poll.id, 'closed')).toBeDefined();
    expect(await finishPoll(db(), poll.id, 'closed')).toBeUndefined();
    await expect(
      castVote(db(), poll.id, snowflake(), [poll.options[0]?.id ?? 0]),
    ).rejects.toBeInstanceOf(UserError);

    const expired = await insertPoll(
      db(),
      base({ closesAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      castVote(db(), expired.id, snowflake(), [expired.options[0]?.id ?? 0]),
    ).rejects.toThrow('closed');
  });

  it('keeps counts exact under concurrent voting', async () => {
    const poll = await insertPoll(db(), base());
    const [pizza, sushi] = poll.options.map((o) => o.id);
    const user = snowflake();
    const voters = Array.from({ length: 20 }, () => snowflake());

    await Promise.all([
      ...voters.map((voter) => castVote(db(), poll.id, voter, [pizza ?? 0])),
      ...Array.from({ length: 10 }, (_, n) =>
        castVote(db(), poll.id, user, [(n % 2 === 0 ? pizza : sushi) ?? 0]),
      ),
    ]);
    const results = await getResults(db(), poll);

    expect(results.voters).toBe(21);
    expect(await getVoterChoices(db(), poll.id, user)).toHaveLength(1);
  });

  it('closes on schedule and hides live counts when requested', async () => {
    const poll = await insertPoll(db(), base({ showResults: 'closed' }));

    await castVote(db(), poll.id, snowflake(), [poll.options[0]?.id ?? 0]);
    const hidden = JSON.stringify(
      renderPoll(poll, await getResults(db(), poll)).embeds,
    );

    expect(hidden).not.toContain('█');

    const ctx = {
      db: db(),
      log: pino({ level: 'silent' }),
      client: { channels: { fetch: vi.fn() } },
    } as unknown as AppContext;

    await closeJob.run(
      { pollId: poll.id },
      { id: 1, runAt: new Date(), attempt: 1 },
      ctx,
    );
    const closed = await getPoll(db(), poll.id);

    expect(closed?.status).toBe('closed');
    if (closed) {
      const rendered = renderPoll(closed, await getResults(db(), closed));

      expect(JSON.stringify(rendered.embeds)).toContain('Winner');
      expect(rendered.components).toEqual([]);
    }
  });
});
