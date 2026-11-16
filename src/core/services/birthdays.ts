import { format } from 'date-fns';
import { z } from 'zod';
import {
  birthdayVisibilities,
  calendarDay,
  channelMention,
  nextDailyRun,
  PermanentError,
  UserError,
  userMention,
  type Actor,
  type BirthdayVisibility,
} from '~/domain';
import type {
  Authorizer,
  Birthday,
  BirthdayRepository,
  BirthdaySettings,
  Directory,
  Logger,
  Messenger,
  Scheduler,
} from '~/core/ports';
import { sequential } from '~/lib';
import { guard } from './guard';
import { defineJob } from './jobs';

const dailyKey = (guildId: string) => `birthdays:${guildId}`;

export type BirthdayConfiguration = {
  channelId?: string;
  roleId?: string | null;
  hour?: number;
  disable?: boolean;
};

export function describeBirthday(birthday: Birthday): string {
  const date = format(
    new Date(2024, birthday.month - 1, birthday.day),
    'd MMMM',
  );

  return `${userMention(birthday.userId)} — ${date}`;
}

type Deps = {
  birthdays: BirthdayRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  directory: Directory;
  authz: Authorizer;
  log: Logger;
  timezone: string;
};

export function createBirthdayService(deps: Deps) {
  const { birthdays, scheduler, messenger, directory, authz, log, timezone } =
    deps;

  const removeRoleJob = defineJob({
    type: 'birthdays.remove-role',
    payload: z.object({
      guildId: z.string(),
      userId: z.string(),
      roleId: z.string(),
    }),
    handle: async ({ guildId, userId, roleId }) => {
      try {
        await directory.removeRoles(
          { guildId, userId },
          [roleId],
          'Birthday is over',
        );
      } catch (error) {
        if (!(error instanceof PermanentError)) {
          throw error;
        }
      }
    },
  });

  const giveRole = async (
    settings: BirthdaySettings,
    roleId: string,
    userIds: string[],
  ) => {
    const midnight = nextDailyRun(timezone, 0);

    await sequential(userIds, async (userId) => {
      try {
        await directory.addRoles(
          { guildId: settings.guildId, userId },
          [roleId],
          'Birthday',
        );
        await scheduler.schedule(
          removeRoleJob,
          { guildId: settings.guildId, userId, roleId },
          {
            runAt: midnight,
            key: `birthday-role:${settings.guildId}:${userId}`,
          },
        );
      } catch (error) {
        log.warn({ err: error, userId }, 'Could not give birthday role');
      }
    });
  };

  const announce = async (
    settings: BirthdaySettings,
    userIds: string[],
    year: number,
  ) => {
    try {
      await messenger.send(settings.channelId, {
        content: `🎉 Palju õnne! Happy birthday ${userIds.map((id) => userMention(id)).join(', ')}!`,
        mentions: { users: userIds },
      });
    } catch (error) {
      if (!(error instanceof PermanentError)) {
        await birthdays.release(settings.guildId, userIds, year);

        throw error;
      }

      log.error(
        { err: error, guildId: settings.guildId },
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

        if (settings.roleId !== null) {
          await giveRole(settings, settings.roleId, userIds);
        }
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

    if (typeof change.roleId === 'string') {
      const role = await directory.role(actor.guildId, change.roleId);

      if (!role || role.managed || !role.botCanAssign) {
        throw new UserError('I cannot manage that role.');
      }
    }

    return {
      guildId: actor.guildId,
      channelId,
      roleId:
        change.roleId === undefined ? (current?.roleId ?? null) : change.roleId,
      hour: change.hour ?? current?.hour ?? 9,
    };
  };

  return {
    jobs: [dailyJob, removeRoleJob],
    set: async (
      actor: Actor,
      birthday: { day: number; month: number; visibility?: string },
    ) => {
      const visibility: BirthdayVisibility =
        birthdayVisibilities.find((v) => v === birthday.visibility) ?? 'public';

      await birthdays.set({
        guildId: actor.guildId,
        userId: actor.userId,
        day: birthday.day,
        month: birthday.month,
        visibility,
      });

      return visibility;
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

        const role = settings.roleId === null ? '' : ' with a role for the day';

        return `Birthdays are announced in ${channelMention(settings.channelId)} at ${settings.hour}:00 (${timezone})${role}.`;
      },
    ),
  };
}

export type BirthdayService = ReturnType<typeof createBirthdayService>;
