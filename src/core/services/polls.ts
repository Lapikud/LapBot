import { z } from 'zod';
import {
  channelMention,
  controlId,
  discordTime,
  isPollOpen,
  parseFutureWhen,
  UserError,
  type Actor,
  type Message,
} from '~/domain';
import type {
  Authorizer,
  Directory,
  Logger,
  Messenger,
  NewPoll,
  Poll,
  PollRepository,
  PollResults,
  PollWithOptions,
  Scheduler,
} from '~/core/ports';
import { defineJob } from './jobs';

const closeKey = (id: number) => `poll:${id}:close`;

export type PollRequest = {
  question: string;
  options: readonly string[];
  channelId: string;
  multiple?: boolean;
  anonymous?: boolean;
  showResults?: 'live' | 'closed';
  closes?: string;
};

function bar(votes: number, total: number): string {
  const filled = total === 0 ? 0 : Math.round((votes / total) * 10);

  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function describeOutcome(results: PollResults, leader: string): string {
  const label = results.tie ? 'Tie' : leader;

  return `**${label}:** ${results.winners.map((w) => w.label).join(', ')}`;
}

function statusLine(poll: Poll, open: boolean): string {
  if (open) {
    return poll.closesAt === null
      ? 'Open'
      : `Closes ${discordTime(poll.closesAt, 'R')}`;
  }

  return poll.status === 'cancelled' ? 'Cancelled' : 'Closed';
}

export function pollView(poll: PollWithOptions, results: PollResults): Message {
  const open = isPollOpen(poll);
  const showCounts = poll.showResults === 'live' || !open;
  const lines = results.options.map((option) =>
    showCounts
      ? `${bar(option.votes, results.voters)} ${option.votes} · **${option.label}**`
      : `• ${option.label}`,
  );
  const outcome =
    !open && results.winners.length > 0
      ? [describeOutcome(results, 'Winner')]
      : [];
  const footer = [
    `Poll #${poll.id}`,
    poll.multiple ? 'multiple choice' : 'single choice',
    poll.anonymous ? 'anonymous' : 'votes visible to organizers',
    `${results.voters} voter${results.voters === 1 ? '' : 's'}`,
    statusLine(poll, open),
  ].join(' · ');

  return {
    content: [`# ${poll.question}`, ...lines, ...outcome, `-# ${footer}`].join(
      '\n',
    ),
    controls: open
      ? [
          [
            {
              kind: 'select',
              id: controlId('polls:vote', poll.id),
              placeholder: poll.multiple ? 'Choose one or more' : 'Choose one',
              min: 1,
              max: poll.multiple ? poll.options.length : 1,
              options: poll.options.map((option) => ({
                label: option.label,
                value: String(option.id),
              })),
            },
          ],
          [
            {
              kind: 'button',
              id: controlId('polls:clear', poll.id),
              label: 'Clear my vote',
              style: 'secondary',
            },
          ],
        ]
      : [],
  };
}

type Deps = {
  polls: PollRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  timezone: string;
};

export function createPollService(deps: Deps) {
  const { polls, scheduler, messenger, directory, authz, log } = deps;

  const refresh = async (id: number) => {
    const poll = await polls.find(id);

    if (poll?.messageId === undefined || poll.messageId === null) {
      return;
    }

    if (
      !(await messenger.edit(
        poll.channelId,
        poll.messageId,
        pollView(poll, await polls.results(poll)),
      ))
    ) {
      log.warn({ pollId: id }, 'Poll message or channel was deleted');
    }
  };

  const closeJob = defineJob({
    type: 'polls:close',
    payload: z.object({ pollId: z.number().int() }),
    handle: async ({ pollId }) => {
      if (await polls.finish(pollId, 'closed')) {
        await refresh(pollId);
      }
    },
  });

  const publish = async (actor: Actor, input: NewPoll) => {
    if (!(await directory.canPost(actor, input.channelId))) {
      throw new UserError(
        `You cannot post in ${channelMention(input.channelId)} yourself.`,
      );
    }

    const poll = await polls.insert(input);
    const sent = await messenger.send(
      poll.channelId,
      pollView(poll, await polls.results(poll)),
    );

    await polls.setMessage(poll.id, sent.messageId);

    if (poll.closesAt !== null) {
      await scheduler.schedule(
        closeJob,
        { pollId: poll.id },
        { runAt: poll.closesAt, key: closeKey(poll.id) },
      );
    }

    return { ...poll, messageId: sent.messageId };
  };

  const requirePoll = async (actor: Actor, id: number) => {
    const poll = await polls.find(id);

    if (poll?.guildId !== actor.guildId) {
      throw new UserError(`Poll #${id} does not exist.`);
    }

    return poll;
  };

  const isManager = async (actor: Actor, poll: Poll) =>
    poll.creatorId === actor.userId || authz.can(actor, 'poll:manage');

  const requireManager = async (actor: Actor, id: number) => {
    const poll = await requirePoll(actor, id);

    if (poll.creatorId !== actor.userId) {
      await authz.require(actor, 'poll:manage');
    }

    return poll;
  };

  const vote = async (
    actor: Actor,
    id: number,
    optionIds: readonly number[],
  ) => {
    await requirePoll(actor, id);
    await polls.vote(id, actor.userId, optionIds);

    const poll = await requirePoll(actor, id);
    const chosen = poll.options
      .filter((o) => optionIds.includes(o.id))
      .map((o) => o.label);

    return { view: pollView(poll, await polls.results(poll)), chosen };
  };

  return {
    jobs: [closeJob],
    publish,
    results: (poll: PollWithOptions) => polls.results(poll),
    latestBySource: (guildId: string, source: string) =>
      polls.latestBySource(guildId, source),
    open: (guildId: string) => polls.open(guildId),
    create: async (actor: Actor, request: PollRequest) => {
      await authz.require(actor, 'poll:create');

      return publish(actor, {
        guildId: actor.guildId,
        channelId: request.channelId,
        creatorId: actor.userId,
        question: request.question,
        options: request.options.map((label) => ({ label })),
        multiple: request.multiple ?? false,
        anonymous: request.anonymous ?? false,
        showResults: request.showResults ?? 'live',
        closesAt:
          request.closes === undefined
            ? null
            : parseFutureWhen(request.closes, deps.timezone),
      });
    },
    vote,
    clear: async (actor: Actor, id: number) => {
      const current = await polls.choices(id, actor.userId);

      if (current.length === 0) {
        throw new UserError('You have not voted.');
      }

      return vote(actor, id, []);
    },
    summary: async (actor: Actor, id: number) => {
      const poll = await requirePoll(actor, id);
      const manager = await isManager(actor, poll);

      if (poll.showResults === 'closed' && isPollOpen(poll) && !manager) {
        throw new UserError('Results are shown when the poll closes.');
      }

      const results = await polls.results(poll);
      const voters =
        !poll.anonymous && manager ? await polls.voters(poll.id) : undefined;

      return { poll, results, voters };
    },
    close: async (actor: Actor, id: number) => {
      await requireManager(actor, id);

      if (!(await polls.finish(id, 'closed'))) {
        throw new UserError('That poll is not open.');
      }

      await scheduler.cancel(closeJob, closeKey(id));
      await refresh(id);
    },
    cancel: async (actor: Actor, id: number) => {
      await requireManager(actor, id);

      if (!(await polls.finish(id, 'cancelled'))) {
        throw new UserError('That poll is not open.');
      }

      await scheduler.cancel(closeJob, closeKey(id));
      await refresh(id);
    },
  };
}

export type PollService = ReturnType<typeof createPollService>;
