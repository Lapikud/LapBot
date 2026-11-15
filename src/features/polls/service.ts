import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  sql,
} from 'drizzle-orm';
import type { Db } from '~/infra/db';
import { UserError } from '~/domain';
import {
  pollOptions,
  polls,
  pollVotes,
  type Poll,
  type PollOption,
} from './schema';

export const maxOptions = 25;

export type NewPoll = Pick<
  Poll,
  'guildId' | 'channelId' | 'creatorId' | 'question'
> &
  Partial<
    Pick<Poll, 'multiple' | 'anonymous' | 'showResults' | 'closesAt' | 'source'>
  > & {
    options: ReadonlyArray<{ label: string; ref?: string | null }>;
  };

export type PollWithOptions = Poll & { options: PollOption[] };

export type OptionResult = PollOption & { votes: number };

export type PollResults = {
  options: OptionResult[];
  voters: number;
  winners: OptionResult[];
  tie: boolean;
};

export async function insertPoll(
  db: Db,
  input: NewPoll,
): Promise<PollWithOptions> {
  const labels = input.options.map((option) => option.label.trim());

  if (labels.length < 2 || labels.length > maxOptions) {
    throw new UserError(`A poll needs between 2 and ${maxOptions} options.`);
  }

  if (labels.some((label) => label === '' || label.length > 100)) {
    throw new UserError('Options must be 1–100 characters.');
  }

  if (
    new Set(labels.map((label) => label.toLowerCase())).size !== labels.length
  ) {
    throw new UserError('Options must be distinct.');
  }

  return db.transaction(async (tx) => {
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

export async function requirePoll(
  db: Db,
  guildId: string,
  id: number,
): Promise<PollWithOptions> {
  const poll = await getPoll(db, id);

  if (poll?.guildId !== guildId) {
    throw new UserError(`Poll #${id} does not exist.`);
  }

  return poll;
}

export function isOpen(poll: Poll, now = new Date()): boolean {
  return (
    poll.status === 'open' && (poll.closesAt === null || poll.closesAt > now)
  );
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

    if (!poll || !isOpen(poll)) {
      throw new UserError('This poll is closed.');
    }

    const unique = [...new Set(optionIds)];

    if (!poll.multiple && unique.length > 1) {
      throw new UserError('This poll allows only one choice.');
    }

    if (unique.length > 0) {
      const valid = await tx
        .select({ id: pollOptions.id })
        .from(pollOptions)
        .where(
          and(eq(pollOptions.pollId, pollId), inArray(pollOptions.id, unique)),
        );

      if (valid.length !== unique.length) {
        throw new UserError('That option is not part of this poll.');
      }
    }

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
  const [counts, [voters]] = await Promise.all([
    db
      .select({ optionId: pollVotes.optionId, votes: count() })
      .from(pollVotes)
      .where(eq(pollVotes.pollId, poll.id))
      .groupBy(pollVotes.optionId),
    db
      .select({ total: countDistinct(pollVotes.userId) })
      .from(pollVotes)
      .where(eq(pollVotes.pollId, poll.id)),
  ]);
  const byOption = new Map(counts.map((row) => [row.optionId, row.votes]));
  const options = poll.options.map((option) => ({
    ...option,
    votes: byOption.get(option.id) ?? 0,
  }));
  const top = Math.max(0, ...options.map((option) => option.votes));
  const winners =
    top === 0 ? [] : options.filter((option) => option.votes === top);

  return {
    options,
    voters: voters?.total ?? 0,
    winners,
    tie: winners.length > 1,
  };
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
  const [row] = await db
    .update(polls)
    .set({
      status,
      ...(status === 'closed' && {
        closesAt: sql`least(${polls.closesAt}, now())`,
      }),
    })
    .where(and(eq(polls.id, id), eq(polls.status, 'open')))
    .returning();

  return row;
}

export async function setPollMessage(
  db: Db,
  id: number,
  messageId: string,
): Promise<void> {
  await db.update(polls).set({ messageId }).where(eq(polls.id, id));
}

export async function listOpenPolls(db: Db, guildId: string): Promise<Poll[]> {
  return db
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
