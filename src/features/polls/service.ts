import { renderPoll, pollDetails } from './message';
import { z } from 'zod';
import { channelMention, type Message } from '~/core/message';
import { parseFutureWhen } from '~/core/helpers/time';
import { UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { isPollOpen } from './rules';
import type { Authorizer } from '~/core/ports/authorization';
import type { Directory } from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { Messenger } from '~/core/ports/messenger';
import { type Scheduler } from '~/core/ports/scheduler';
import { defineJob } from '~/core/helpers/jobs';
import type {
  NewPoll,
  Poll,
  PollResults,
  PollWithOptions,
  PollRepository,
} from './model';

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
    type: 'polls.close',
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

    if (input.question.trim() === '' || input.question.length > 256) {
      throw new UserError('Poll questions must be 1-256 characters.');
    }

    const details = pollDetails(input);
    const poll = await polls.insert(input);

    for (const message of details) {
      // Preserve option order and keep the voting controls after every detail post.
      // eslint-disable-next-line no-await-in-loop
      await messenger.send(poll.channelId, message);
    }

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

    if (
      poll?.guildId !== actor.guildId ||
      !(await directory.canView(actor, poll.channelId))
    ) {
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

export function pollView(poll: PollWithOptions, results: PollResults): Message {
  return renderPoll(poll, results, new Date());
}
