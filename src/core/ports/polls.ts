import type { Tally } from '~/domain';

export type PollStatus = 'open' | 'closed' | 'cancelled';

export type Poll = {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  creatorId: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  showResults: 'live' | 'closed';
  closesAt: Date | null;
  status: PollStatus;
  source: string | null;
  createdAt: Date;
};

export type PollOption = {
  id: number;
  pollId: number;
  position: number;
  label: string;
  ref: string | null;
  url: string | null;
};

export type PollWithOptions = Poll & { options: PollOption[] };

export type PollResults = Tally<PollOption>;

export type NewPoll = Pick<
  Poll,
  'guildId' | 'channelId' | 'creatorId' | 'question'
> &
  Partial<
    Pick<Poll, 'multiple' | 'anonymous' | 'showResults' | 'closesAt' | 'source'>
  > & {
    options: ReadonlyArray<{
      label: string;
      ref?: string | null;
      url?: string | null;
    }>;
  };

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
