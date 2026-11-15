import { z } from 'zod';
import {
  channelMention,
  nextFutureOccurrence,
  parseFutureWhen,
  PermanentError,
  recurrences,
  requireZone,
  UserError,
  userMention,
  type Actor,
  type Recurrence,
} from '~/domain';
import type {
  Authorizer,
  Directory,
  Messenger,
  NewReminder,
  Reminder,
  ReminderRepository,
  Scheduler,
} from '~/core/ports';
import { defineJob } from './jobs';

const jobKey = (id: number) => `reminder:${id}`;

export type ReminderRequest = {
  when: string;
  message: string;
  channelId?: string;
  repeat?: string;
  timezone?: string;
};

type Deps = {
  reminders: ReminderRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  directory: Directory;
  authz: Authorizer;
  timezone: (guildId: string) => Promise<string>;
};

export function createReminderService(deps: Deps) {
  const { reminders, scheduler, messenger, directory, authz, timezone } = deps;

  const deliver = async (reminder: Reminder) => {
    const text = `⏰ **Reminder:** ${reminder.message}`;

    if (reminder.channelId === null) {
      await messenger.direct(reminder.userId, { content: text });

      return;
    }

    await messenger.send(reminder.channelId, {
      content: `${userMention(reminder.userId)} ${text}`,
      mentions: { users: [reminder.userId] },
    });
  };

  const deliverJob = defineJob({
    type: 'reminders:deliver',
    payload: z.object({ reminderId: z.number().int() }),
    handle: async ({ reminderId }) => {
      const reminder = await reminders.find(reminderId);

      if (reminder?.status !== 'active') {
        return null;
      }

      try {
        await deliver(reminder);
      } catch (error) {
        if (error instanceof PermanentError) {
          await reminders.update(reminder.id, {
            status: 'failed',
            failure: error.message,
          });
        }

        throw error;
      }

      if (reminder.recurrence === null) {
        await reminders.update(reminder.id, { status: 'done' });

        return null;
      }

      const next = nextFutureOccurrence(
        reminder.runAt,
        reminder.recurrence,
        reminder.timezone,
      );

      await reminders.update(reminder.id, { runAt: next });

      return { rescheduleAt: next };
    },
  });

  const queue = (reminder: Reminder) =>
    scheduler.schedule(
      deliverJob,
      { reminderId: reminder.id },
      { runAt: reminder.runAt, key: jobKey(reminder.id) },
    );

  const schedule = async (input: NewReminder) => {
    const reminder = await reminders.insert(input);

    await queue(reminder);

    return reminder;
  };

  const own = async (actor: Actor, id: number) => {
    const reminder = await reminders.find(id);

    if (
      reminder?.guildId !== actor.guildId ||
      reminder.userId !== actor.userId ||
      reminder.status !== 'active'
    ) {
      throw new UserError(`You have no active reminder #${id}.`);
    }

    return reminder;
  };

  return {
    jobs: [deliverJob],
    schedule,
    create: async (actor: Actor, request: ReminderRequest) => {
      if (request.channelId !== undefined) {
        await authz.require(actor, 'reminder:channel');

        if (!(await directory.canPost(actor, request.channelId))) {
          throw new UserError(
            `You cannot post in ${channelMention(request.channelId)} yourself.`,
          );
        }
      }

      const zone =
        request.timezone === undefined
          ? await timezone(actor.guildId)
          : requireZone(request.timezone);
      const recurrence: Recurrence | null =
        recurrences.find((r) => r === request.repeat) ?? null;

      return schedule({
        guildId: actor.guildId,
        userId: actor.userId,
        channelId: request.channelId ?? null,
        message: request.message,
        runAt: parseFutureWhen(request.when, zone),
        recurrence,
        timezone: zone,
      });
    },
    list: (actor: Actor) => reminders.active(actor.guildId, actor.userId),
    edit: async (
      actor: Actor,
      id: number,
      changes: { when?: string; message?: string },
    ) => {
      const reminder = await own(actor, id);

      if (changes.when === undefined && changes.message === undefined) {
        throw new UserError('Give a new time or message.');
      }

      const updated = {
        ...reminder,
        message: changes.message ?? reminder.message,
        runAt:
          changes.when === undefined
            ? reminder.runAt
            : parseFutureWhen(changes.when, reminder.timezone),
      };

      await reminders.update(id, {
        message: updated.message,
        runAt: updated.runAt,
      });
      await queue(updated);

      return updated;
    },
    cancel: async (actor: Actor, id: number) => {
      await own(actor, id);
      await reminders.update(id, { status: 'cancelled' });
      await scheduler.cancel(jobKey(id));
    },
  };
}

export type ReminderService = ReturnType<typeof createReminderService>;
