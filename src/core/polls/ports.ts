import type {
  Poll,
  PollWithOptions,
  PollResults,
  NewPoll,
} from '~/domain/polls';
export type PollRepository = {
  insert: (poll: NewPoll) => Promise<PollWithOptions>;
  find: (id: number) => Promise<PollWithOptions | undefined>;
  vote: (
    pollId: number,
    userId: string,
    optionIds: readonly number[],
  ) => Promise<void>;
  results: (poll: PollWithOptions) => Promise<PollResults>;
  choices: (pollId: number, userId: string) => Promise<number[]>;
  voters: (pollId: number) => Promise<Map<number, string[]>>;
  finish: (
    id: number,
    status: 'closed' | 'cancelled',
  ) => Promise<Poll | undefined>;
  setMessage: (id: number, messageId: string) => Promise<void>;
  open: (guildId: string) => Promise<Poll[]>;
  latestBySource: (
    guildId: string,
    source: string,
  ) => Promise<PollWithOptions | undefined>;
};
