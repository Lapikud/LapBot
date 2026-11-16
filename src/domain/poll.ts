import { UserError } from './errors';

export const maxPollOptions = 10;

export const maxOptionLength = 55;

export type Tally<O> = {
  options: Array<O & { votes: number }>;
  voters: number;
  winners: Array<O & { votes: number }>;
  tie: boolean;
};

export function isPollOpen(
  poll: { status: string; closesAt: Date | null },
  now = new Date(),
): boolean {
  return (
    poll.status === 'open' && (poll.closesAt === null || poll.closesAt > now)
  );
}

export function tally<O extends { id: number }>(
  options: readonly O[],
  votes: ReadonlyMap<number, number>,
  voters: number,
): Tally<O> {
  const counted = options.map((option) => ({
    ...option,
    votes: votes.get(option.id) ?? 0,
  }));
  const top = Math.max(0, ...counted.map((option) => option.votes));
  const winners =
    top === 0 ? [] : counted.filter((option) => option.votes === top);

  return { options: counted, voters, winners, tie: winners.length > 1 };
}

export function validatePollOptions(labels: readonly string[]): string[] {
  const trimmed = labels.map((label) => label.trim());

  if (trimmed.length < 2 || trimmed.length > maxPollOptions) {
    throw new UserError(
      `A poll needs between 2 and ${maxPollOptions} options.`,
    );
  }

  if (trimmed.some((label) => label === '' || label.length > maxOptionLength)) {
    throw new UserError(`Options must be 1–${maxOptionLength} characters.`);
  }

  if (
    new Set(trimmed.map((label) => label.toLowerCase())).size !== trimmed.length
  ) {
    throw new UserError('Options must be distinct.');
  }

  return trimmed;
}
