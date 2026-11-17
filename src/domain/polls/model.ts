import type { Tally } from './rules';

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
