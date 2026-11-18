import { format } from 'date-fns';
import { z } from 'zod';
import { parseBirthdaySubmission } from './form';
import { calendarDay, nextDailyRun } from '~/core/helpers/time';
import {
  channelMention,
  hereMention,
  userMention,
  type Message,
} from '~/core/message';
import { PermanentError, UserError } from '~/core/errors';
import type { Actor } from '~/core/actor';
import { type Authorizer } from '~/core/ports/authorization';
import { guard } from '~/core/helpers/authorization';
import type { Directory } from '~/core/ports/directory';
import type { Logger } from '~/core/ports/logger';
import type { Messenger } from '~/core/ports/messenger';
import { type Scheduler } from '~/core/ports/scheduler';
import { defineJob } from '~/core/helpers/jobs';
import type { Birthday, BirthdaySettings, BirthdayRepository } from './model';

const dailyKey = (guildId: string) => `birthdays:${guildId}`;
const validHour = z.number().int().min(0).max(23);

export interface BirthdayConfiguration {
  channelId?: string;
  hour?: number;
  disable?: boolean;
}

export function describeBirthday(birthday: Birthday): string {
  const date = format(
    new Date(2024, birthday.month - 1, birthday.day),
    'd MMMM',
  );

  return `${userMention(birthday.userId)} - ${date}`;
}

export const birthdaySignup: Message = {
  content: '# 🎂 Sünnipäevad\nLisa oma sünnipäeva kuupäev!',
  controls: [
    [
      {
        kind: 'button',
        id: 'birthdays:add',
        label: 'Lisa oma sünnipäev',
        style: 'primary',
      },
    ],
  ],
};

interface Deps {
  birthdays: BirthdayRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  timezone: string;
}

export function createBirthdayService(deps: Deps) {
  const { birthdays, scheduler, messenger, directory, authz, log, timezone } =
    deps;

  const announce = async (
    settings: BirthdaySettings,
    userIds: string[],
    year: number,
  ) => {
    try {
      await messenger.send(settings.channelId, {
        content: `${hereMention()} 🎉 Palju õnne sünnipäevaks, ${userIds.map((id) => userMention(id)).join(', ')}!`,
        mentions: { users: userIds },
      });
    } catch (error) {
      if (!(error instanceof PermanentError)) {
        await birthdays.release(settings.guildId, userIds, year);

        throw error;
      }

      log.error(
        { error, guildId: settings.guildId },
        'Birthday channel is unusable; skipping today',
      );
    }
  };

  const dailyJob = defineJob({
    type: 'birthdays.daily',
    payload: z.object({ guildId: z.string() }),
    handle: async ({ guildId }) => {
      const settings = await birthdays.settings(guildId);

      if (!settings) {
        return null;
      }

      const today = calendarDay(new Date(), timezone);
      const userIds = await birthdays.claim(guildId, today);

      if (userIds.length > 0) {
        await announce(settings, userIds, today.year);
      }

      return { rescheduleAt: nextDailyRun(timezone, settings.hour) };
    },
  });

  const resolveSettings = async (
    actor: Actor,
    change: BirthdayConfiguration,
  ) => {
    const current = await birthdays.settings(actor.guildId);
    const channelId = change.channelId ?? current?.channelId;

    if (channelId === undefined) {
      throw new UserError('Choose an announcement channel.');
    }

    if (!(await directory.canPost(actor, channelId))) {
      throw new UserError('You cannot post in that birthday channel yourself.');
    }

    const hour = change.hour ?? current?.hour ?? 9;

    if (!validHour.safeParse(hour).success) {
      throw new UserError('Choose an announcement time from 00:00 to 23:00.');
    }

    return {
      guildId: actor.guildId,
      channelId,
      hour,
    };
  };

  return {
    jobs: [dailyJob],
    set: async (
      actor: Actor,
      birthday: { day: number; month: number; visibility?: string },
    ) => {
      const parsed = parseBirthdaySubmission(birthday);

      await birthdays.set({
        guildId: actor.guildId,
        userId: actor.userId,
        ...parsed,
      });

      return parsed.visibility;
    },
    remove: (actor: Actor) => birthdays.remove(actor.guildId, actor.userId),
    view: async (actor: Actor, userId: string) => {
      const birthday = await birthdays.find(actor.guildId, userId);

      return birthday &&
        (userId === actor.userId || birthday.visibility === 'public')
        ? birthday
        : undefined;
    },
    settings: (guildId: string) => birthdays.settings(guildId),
    postSignup: guard(
      authz,
      'birthday:manage',
      async (actor, channelId: string) => {
        if (!(await directory.canPost(actor, channelId))) {
          throw new UserError(
            `You cannot post in ${channelMention(channelId)} yourself.`,
          );
        }

        await messenger.send(channelId, birthdaySignup);
      },
    ),
    upcoming: async (guildId: string) =>
      birthdays.upcoming(guildId, calendarDay(new Date(), timezone)),
    configure: guard(
      authz,
      'birthday:manage',
      async (actor, change: BirthdayConfiguration) => {
        if (change.disable === true) {
          await birthdays.deleteSettings(actor.guildId);
          await scheduler.cancel(dailyJob, dailyKey(actor.guildId));

          return 'Birthday announcements are off.';
        }

        const settings = await resolveSettings(actor, change);

        await birthdays.saveSettings(settings);
        await scheduler.schedule(
          dailyJob,
          { guildId: actor.guildId },
          {
            runAt: nextDailyRun(timezone, settings.hour),
            key: dailyKey(actor.guildId),
          },
        );
        log.info(
          { guildId: actor.guildId, actorId: actor.userId, settings },
          'Birthday settings changed',
        );

        return `Birthdays are announced in ${channelMention(settings.channelId)} at ${settings.hour}:00 (${timezone}).`;
      },
    ),
  };
}

export type BirthdayService = ReturnType<typeof createBirthdayService>;
