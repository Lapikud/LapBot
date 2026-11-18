import { and, asc, count, countDistinct, desc, eq } from 'drizzle-orm';
import type { PollWithOptions, PollRepository } from '~/features/polls/model';
import type { Db } from '../client';
import { isPollOpen, tally, validatePollOptions } from '~/features/polls/rules';
import { validatePollResponse } from '~/features/polls/form';
import { UserError } from '~/core/errors';
import { pollOptions, polls, pollVotes } from './table';

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

export function createPollRepository(db: Db): PollRepository {
  return {
    insert: async (input) => {
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
    },
    find: (id) => getPoll(db, id),
    vote: async (pollId, userId, optionIds) => {
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
          .where(
            and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, userId)),
          );
        if (unique.length > 0) {
          await tx
            .insert(pollVotes)
            .values(unique.map((optionId) => ({ pollId, optionId, userId })));
        }
      });
    },
    results: async (poll) => {
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
    },
    choices: async (pollId, userId) => {
      const rows = await db
        .select({ optionId: pollVotes.optionId })
        .from(pollVotes)
        .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, userId)));

      return rows.map((row) => row.optionId);
    },
    voters: async (pollId) => {
      const rows = await db
        .select({ optionId: pollVotes.optionId, userId: pollVotes.userId })
        .from(pollVotes)
        .where(eq(pollVotes.pollId, pollId))
        .orderBy(asc(pollVotes.createdAt))
        .limit(5000);
      const voters = new Map<number, string[]>();

      for (const row of rows) {
        voters.set(row.optionId, [
          ...(voters.get(row.optionId) ?? []),
          row.userId,
        ]);
      }

      return voters;
    },
    finish: async (id, status) => {
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
    },
    setMessage: async (id, messageId) => {
      await db.update(polls).set({ messageId }).where(eq(polls.id, id));
    },
    open: async (guildId) => {
      return await db
        .select()
        .from(polls)
        .where(and(eq(polls.guildId, guildId), eq(polls.status, 'open')))
        .orderBy(desc(polls.id))
        .limit(25);
    },
    latestBySource: async (guildId, source) => {
      const [row] = await db
        .select({ id: polls.id })
        .from(polls)
        .where(and(eq(polls.guildId, guildId), eq(polls.source, source)))
        .orderBy(desc(polls.createdAt), desc(polls.id))
        .limit(1);

      return row ? getPoll(db, row.id) : undefined;
    },
  };
}
