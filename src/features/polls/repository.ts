import { and, asc, count, countDistinct, desc, eq } from 'drizzle-orm';
import type {
  NewPoll,
  PollResults,
  PollWithOptions,
  PollRepository,
} from './model';
import type { Db } from '~/integrations/db/client';
import { isPollOpen, tally, validatePollOptions } from './rules';
import { validatePollResponse } from './form';
import { UserError } from '~/core/errors';
import { pollOptions, polls, pollVotes, type Poll } from './table';

export async function insertPoll(
  db: Db,
  input: NewPoll,
): Promise<PollWithOptions> {
  const labels = validatePollOptions(
    input.options.map((option) => option.label),
  );

  return await db.transaction(async (tx) => {
    const { options, ...values } = input;
    const [poll] = await tx.insert(polls).values(values).returning();

    if (!poll) {
      throw new Error('Insert returned no row');
    }

    const inserted = await tx
      .insert(pollOptions)
      .values(
        options.map((option, position) => ({
          pollId: poll.id,
          position,
          label: labels[position] ?? '',
          ref: option.ref ?? null,
          url: option.url ?? null,
        })),
      )
      .returning();

    return {
      ...poll,
      options: inserted.toSorted((a, b) => a.position - b.position),
    };
  });
}

export async function getPoll(
  db: Db,
  id: number,
): Promise<PollWithOptions | undefined> {
  const [poll] = await db.select().from(polls).where(eq(polls.id, id));

  if (!poll) {
    return undefined;
  }

  const options = await db
    .select()
    .from(pollOptions)
    .where(eq(pollOptions.pollId, id))
    .orderBy(asc(pollOptions.position));

  return { ...poll, options };
}

export async function castVote(
  db: Db,
  pollId: number,
  userId: string,
  optionIds: readonly number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const [poll] = await tx
      .select()
      .from(polls)
      .where(eq(polls.id, pollId))
      .for('update');

    if (!poll || !isPollOpen(poll)) {
      throw new UserError('This poll is closed.');
    }

    const options = await tx
      .select({ id: pollOptions.id, label: pollOptions.label })
      .from(pollOptions)
      .where(eq(pollOptions.pollId, pollId));
    const unique = validatePollResponse(options, poll.multiple, optionIds);

    await tx
      .delete(pollVotes)
      .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, userId)));
    if (unique.length > 0) {
      await tx
        .insert(pollVotes)
        .values(unique.map((optionId) => ({ pollId, optionId, userId })));
    }
  });
}

export async function getResults(
  db: Db,
  poll: PollWithOptions,
): Promise<PollResults> {
  const totals = db
    .select({ voters: countDistinct(pollVotes.userId).as('voters') })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, poll.id))
    .as('totals');
  const counts = await db
    .select({
      optionId: pollVotes.optionId,
      votes: count(),
      voters: totals.voters,
    })
    .from(pollVotes)
    .crossJoin(totals)
    .where(eq(pollVotes.pollId, poll.id))
    .groupBy(pollVotes.optionId, totals.voters);

  return tally(
    poll.options,
    new Map(counts.map((row) => [row.optionId, row.votes])),
    counts[0]?.voters ?? 0,
  );
}

export async function getVoterChoices(
  db: Db,
  pollId: number,
  userId: string,
): Promise<number[]> {
  const rows = await db
    .select({ optionId: pollVotes.optionId })
    .from(pollVotes)
    .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, userId)));

  return rows.map((row) => row.optionId);
}

export async function getVoters(
  db: Db,
  pollId: number,
): Promise<Map<number, string[]>> {
  const rows = await db
    .select({ optionId: pollVotes.optionId, userId: pollVotes.userId })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, pollId))
    .orderBy(asc(pollVotes.createdAt))
    .limit(5000);
  const voters = new Map<number, string[]>();

  for (const row of rows) {
    voters.set(row.optionId, [...(voters.get(row.optionId) ?? []), row.userId]);
  }

  return voters;
}

export async function finishPoll(
  db: Db,
  id: number,
  status: 'closed' | 'cancelled',
): Promise<Poll | undefined> {
  return await db.transaction(async (tx) => {
    const [poll] = await tx
      .select()
      .from(polls)
      .where(and(eq(polls.id, id), eq(polls.status, 'open')))
      .for('update');

    if (!poll) {
      return poll;
    }

    const [row] = await tx
      .update(polls)
      .set({
        status,
        ...(status === 'closed' && {
          closesAt: new Date(
            Math.min(
              poll.closesAt?.getTime() ?? Number.POSITIVE_INFINITY,
              Date.now(),
            ),
          ),
        }),
      })
      .where(eq(polls.id, id))
      .returning();

    return row;
  });
}

export async function setPollMessage(
  db: Db,
  id: number,
  messageId: string,
): Promise<void> {
  await db.update(polls).set({ messageId }).where(eq(polls.id, id));
}

export async function listOpenPolls(db: Db, guildId: string): Promise<Poll[]> {
  return await db
    .select()
    .from(polls)
    .where(and(eq(polls.guildId, guildId), eq(polls.status, 'open')))
    .orderBy(desc(polls.id))
    .limit(25);
}

export async function latestPollBySource(
  db: Db,
  guildId: string,
  source: string,
): Promise<PollWithOptions | undefined> {
  const [row] = await db
    .select({ id: polls.id })
    .from(polls)
    .where(and(eq(polls.guildId, guildId), eq(polls.source, source)))
    .orderBy(desc(polls.createdAt), desc(polls.id))
    .limit(1);

  return row ? getPoll(db, row.id) : undefined;
}

export function createPollRepository(db: Db): PollRepository {
  return {
    insert: (poll) => insertPoll(db, poll),
    find: (id) => getPoll(db, id),
    vote: (pollId, userId, optionIds) =>
      castVote(db, pollId, userId, optionIds),
    results: (poll) => getResults(db, poll),
    choices: (pollId, userId) => getVoterChoices(db, pollId, userId),
    voters: (pollId) => getVoters(db, pollId),
    finish: (id, status) => finishPoll(db, id, status),
    setMessage: (id, messageId) => setPollMessage(db, id, messageId),
    open: (guildId) => listOpenPolls(db, guildId),
    latestBySource: (guildId, source) =>
      latestPollBySource(db, guildId, source),
  };
}
