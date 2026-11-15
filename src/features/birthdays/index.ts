import {
  ChannelType,
  InteractionContextType,
  SlashCommandBuilder,
  channelMention,
  roleMention,
  userMention,
} from 'discord.js';
import { format } from 'date-fns';
import { z } from 'zod';
import {
  respond,
  bySubcommand,
  defineJob,
  isPermanentDiscordError,
} from '~/infra/discord';
import type { AppContext, CommandInteraction, Feature } from '~/infra/discord';
import { getGuildTimezone } from '~/infra/db';
import { sequential } from '~/lib';
import { UserError, calendarDay, nextDailyRun } from '~/domain';
import {
  birthdayVisibility,
  type Birthday,
  type BirthdayVisibility,
} from './schema';
import {
  claimTodaysBirthdays,
  deleteSettings,
  getBirthday,
  getSettings,
  releaseClaims,
  removeBirthday,
  saveSettings,
  setBirthday,
  upcomingBirthdays,
} from './service';

const dailyKey = (guildId: string) => `birthdays:${guildId}`;
const visibilities = birthdayVisibility.enumValues;

const removeRoleJob = defineJob({
  type: 'birthdays:remove-role',
  payload: z.object({
    guildId: z.string(),
    userId: z.string(),
    roleId: z.string(),
  }),
  handle: async ({ guildId, userId, roleId }, _info, ctx) => {
    try {
      const guild = await ctx.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      await member.roles.remove(roleId, 'Birthday is over');
    } catch (error) {
      if (!isPermanentDiscordError(error)) {
        throw error;
      }
    }
  },
});

async function giveRole(
  ctx: AppContext,
  target: { guildId: string; roleId: string; zone: string },
  userIds: string[],
) {
  const { guildId, roleId, zone } = target;
  const guild = await ctx.client.guilds.fetch(guildId);
  const midnight = nextDailyRun(zone, 0);

  await sequential(userIds, async (userId) => {
    try {
      const member = await guild.members.fetch(userId);

      await member.roles.add(roleId, 'Birthday');
      await ctx.scheduler.schedule(
        removeRoleJob,
        { guildId, userId, roleId },
        {
          runAt: midnight,
          key: `birthday-role:${guildId}:${userId}`,
        },
      );
    } catch (error) {
      ctx.log.warn({ err: error, userId }, 'Could not give birthday role');
    }
  });
}

export const dailyJob = defineJob({
  type: 'birthdays:daily',
  payload: z.object({ guildId: z.string() }),
  handle: async ({ guildId }, _info, ctx) => {
    const settings = await getSettings(ctx.db, guildId);

    if (!settings) {
      return null;
    }

    const zone = await getGuildTimezone(
      ctx.db,
      guildId,
      ctx.config.DEFAULT_TIMEZONE,
    );
    const today = calendarDay(new Date(), zone);
    const userIds = await claimTodaysBirthdays(ctx.db, guildId, today);

    if (userIds.length > 0) {
      try {
        const channel = await ctx.client.channels.fetch(settings.channelId);

        if (channel?.isSendable() !== true) {
          throw new UserError('Birthday channel is not available');
        }

        await channel.send({
          content: `🎉 Palju õnne! Happy birthday ${userIds.map((id) => userMention(id)).join(', ')}!`,
          allowedMentions: { users: userIds },
        });
      } catch (error) {
        if (!isPermanentDiscordError(error) && !(error instanceof UserError)) {
          await releaseClaims(ctx.db, guildId, userIds, today.year);
          throw error;
        }

        ctx.log.error(
          { err: error, guildId },
          'Birthday channel is unusable; skipping today',
        );
      }

      if (settings.roleId !== null) {
        await giveRole(
          ctx,
          { guildId, roleId: settings.roleId, zone },
          userIds,
        );
      }
    }

    return { rescheduleAt: nextDailyRun(zone, settings.hour) };
  },
});

function describe(birthday: Birthday): string {
  const date = format(
    new Date(2024, birthday.month - 1, birthday.day),
    'd MMMM',
  );

  return `<@${birthday.userId}> — ${date}`;
}

const data = new SlashCommandBuilder()
  .setName('birthday')
  .setDescription('Birthdays')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Save your birthday (no year needed)')
      .addIntegerOption((o) =>
        o
          .setName('day')
          .setDescription('Day')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(31),
      )
      .addIntegerOption((o) =>
        o
          .setName('month')
          .setDescription('Month')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(12),
      )
      .addStringOption((o) =>
        o
          .setName('visibility')
          .setDescription(
            'public: announced and listed; announce: announced only; private: neither',
          )
          .addChoices(visibilities.map((v) => ({ name: v, value: v }))),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('remove').setDescription('Delete your birthday data'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('view')
      .setDescription('See a birthday')
      .addUserOption((o) =>
        o.setName('member').setDescription('Member (default: you)'),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('upcoming').setDescription('Upcoming public birthdays'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('settings')
      .setDescription('Configure birthday announcements')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Announcement channel')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role to give for the day'),
      )
      .addIntegerOption((o) =>
        o
          .setName('hour')
          .setDescription('Hour to announce (server time)')
          .setMinValue(0)
          .setMaxValue(23),
      )
      .addBooleanOption((o) =>
        o.setName('disable').setDescription('Turn announcements off'),
      ),
  );

async function readSettings(
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<{
  guildId: string;
  channelId: string;
  roleId: string | null;
  hour: number;
}> {
  const current = await getSettings(ctx.db, interaction.guildId);
  const channelId =
    interaction.options.getChannel('channel')?.id ?? current?.channelId;

  if (channelId === undefined) {
    throw new UserError('Choose an announcement channel.');
  }

  const role = interaction.options.getRole('role');

  if (role && (role.managed || !role.editable)) {
    throw new UserError(`I cannot manage ${role.name}.`);
  }

  return {
    guildId: interaction.guildId,
    channelId,
    roleId: role?.id ?? current?.roleId ?? null,
    hour: interaction.options.getInteger('hour') ?? current?.hour ?? 9,
  };
}

async function configure(
  interaction: CommandInteraction,
  ctx: AppContext,
): Promise<void> {
  const guildId = interaction.guildId;

  if (interaction.options.getBoolean('disable') === true) {
    await deleteSettings(ctx.db, guildId);
    await ctx.scheduler.cancel(dailyKey(guildId));
    await respond(interaction, 'Birthday announcements are off.');

    return;
  }

  const settings = await readSettings(interaction, ctx);

  await saveSettings(ctx.db, settings);
  const zone = await getGuildTimezone(
    ctx.db,
    guildId,
    ctx.config.DEFAULT_TIMEZONE,
  );

  await ctx.scheduler.schedule(
    dailyJob,
    { guildId },
    { runAt: nextDailyRun(zone, settings.hour), key: dailyKey(guildId) },
  );
  ctx.log.info(
    { guildId, actorId: interaction.user.id, settings },
    'Birthday settings changed',
  );
  const role =
    settings.roleId === null
      ? ''
      : ` with ${roleMention(settings.roleId)} for the day`;

  await respond(
    interaction,
    `Birthdays are announced in ${channelMention(settings.channelId)} at ${settings.hour}:00 (${zone})${role}.`,
  );
}

export const birthdaysFeature: Feature = {
  name: 'birthdays',
  permissions: [
    { id: 'birthday:manage', description: 'Configure birthday announcements' },
  ],
  jobs: [dailyJob, removeRoleJob],
  commands: [
    {
      data: data.toJSON(),
      permissions: { settings: 'birthday:manage' },
      execute: bySubcommand({
        set: async (interaction, ctx) => {
          const visibility: BirthdayVisibility =
            visibilities.find(
              (v) => v === interaction.options.getString('visibility'),
            ) ?? 'public';

          await setBirthday(ctx.db, {
            guildId: interaction.guildId,
            userId: interaction.user.id,
            day: interaction.options.getInteger('day', true),
            month: interaction.options.getInteger('month', true),
            visibility,
          });
          const leap =
            interaction.options.getInteger('month', true) === 2 &&
            interaction.options.getInteger('day', true) === 29
              ? ' In non-leap years it is celebrated on 28 February.'
              : '';

          await respond(interaction, `Saved (${visibility}).${leap}`);
        },
        remove: async (interaction, ctx) => {
          const removed = await removeBirthday(
            ctx.db,
            interaction.guildId,
            interaction.user.id,
          );

          await respond(
            interaction,
            removed
              ? 'Your birthday data is deleted.'
              : 'You had no birthday saved.',
          );
        },
        view: async (interaction, ctx) => {
          const user =
            interaction.options.getUser('member') ?? interaction.user;
          const birthday = await getBirthday(
            ctx.db,
            interaction.guildId,
            user.id,
          );
          const visible =
            birthday &&
            (user.id === interaction.user.id ||
              birthday.visibility === 'public');

          await respond(
            interaction,
            visible === true ? describe(birthday) : 'No birthday to show.',
          );
        },
        upcoming: async (interaction, ctx) => {
          const zone = await getGuildTimezone(
            ctx.db,
            interaction.guildId,
            ctx.config.DEFAULT_TIMEZONE,
          );
          const list = await upcomingBirthdays(
            ctx.db,
            interaction.guildId,
            calendarDay(new Date(), zone),
          );

          await respond(
            interaction,
            list.length === 0
              ? 'No public birthdays yet.'
              : list.map((birthday) => describe(birthday)).join('\n'),
          );
        },
        settings: configure,
      }),
    },
  ],
};
