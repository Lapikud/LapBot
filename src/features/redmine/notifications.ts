import { MessageFlags } from 'discord.js';
import { z } from 'zod';
import { defineJob } from '~/core/define';
import { sequential } from '~/shared/async';
import type { AppContext } from '~/core/feature';
import type {
  RedmineClient,
  RedmineStatus,
} from '~/integrations/redmine/client';
import {
  addCalendarDays,
  calendarDay,
  formatCalendarDay,
  nextDailyRun,
} from '~/shared/time';
import type { RedmineSubscription } from './schema';
import {
  claimNotification,
  issueNotifications,
  listSubscriptions,
  setCheckpoint,
  type Notification,
} from './service';

const pollIntervalMs = 2 * 60 * 1000;
const issuesPerPoll = 25;
const deadlineHour = 9;

export const pollKey = 'redmine:poll';
export const deadlineKey = 'redmine:deadlines';

type Source = {
  redmine: RedmineClient;
  baseUrl: string;
  statuses: ReadonlyMap<number, RedmineStatus>;
};

async function forEachSubscription(
  ctx: AppContext,
  handle: (subscription: RedmineSubscription) => Promise<void>,
  afterId = 0,
): Promise<void> {
  const page = await listSubscriptions(ctx.db, afterId);

  await sequential(page, async (subscription) => {
    try {
      await handle(subscription);
    } catch (error) {
      ctx.log.warn(
        { err: error, subscriptionId: subscription.id },
        'Redmine subscription update failed',
      );
    }
  });

  const last = page.at(-1);

  if (last !== undefined) {
    await forEachSubscription(ctx, handle, last.id);
  }
}

async function sendOnce(
  ctx: AppContext,
  subscription: RedmineSubscription,
  notification: Notification,
) {
  if (!(await claimNotification(ctx.db, subscription.id, notification.key))) {
    return;
  }

  const channel = await ctx.client.channels.fetch(subscription.channelId);

  if (channel?.isSendable() === true) {
    await channel.send({
      content: notification.text.slice(0, 2000),
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressEmbeds,
    });
  }
}

async function pollSubscription(
  ctx: AppContext,
  source: Source,
  subscription: RedmineSubscription,
): Promise<void> {
  const { redmine, baseUrl, statuses } = source;
  const { issues } = await redmine.listIssues({
    projectId: subscription.projectId,
    status: '*',
    updatedSince: subscription.checkpoint,
    sort: 'updated_on:asc',
    limit: issuesPerPoll,
  });
  let checkpoint = subscription.checkpoint;

  await sequential(issues, async (summary) => {
    const issue = await redmine.getIssue(summary.id, true);
    const url = new URL(`issues/${issue.id}`, baseUrl).href;
    const notifications = issueNotifications(
      issue,
      subscription.checkpoint,
      statuses,
      url,
    );

    await sequential(notifications, (notification) =>
      sendOnce(ctx, subscription, notification),
    );

    const updated = new Date(issue.updated_on);

    if (updated > checkpoint) {
      checkpoint = updated;
    }
  });

  if (checkpoint > subscription.checkpoint) {
    await setCheckpoint(ctx.db, subscription.id, checkpoint);
  }
}

export function createNotificationJobs(
  redmine: RedmineClient,
  baseUrl: string,
) {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  const pollJob = defineJob({
    type: 'redmine:poll',
    payload: z.object({}),
    handle: async (_payload, _info, ctx) => {
      const known = await redmine.listStatuses().catch(() => []);
      const statuses = new Map(known.map((status) => [status.id, status]));

      await forEachSubscription(ctx, (subscription) =>
        pollSubscription(
          ctx,
          { redmine, baseUrl: root, statuses },
          subscription,
        ),
      );

      return { rescheduleAt: new Date(Date.now() + pollIntervalMs) };
    },
  });

  const deadlineJob = defineJob({
    type: 'redmine:deadlines',
    payload: z.object({}),
    handle: async (_payload, _info, ctx) => {
      const zone = ctx.config.DEFAULT_TIMEZONE;
      const tomorrow = formatCalendarDay(
        addCalendarDays(calendarDay(new Date(), zone), 1),
      );

      await forEachSubscription(ctx, async (subscription) => {
        const { issues } = await redmine.listIssues({
          projectId: subscription.projectId,
          dueDate: tomorrow,
          limit: 50,
        });

        const visible = issues.filter((issue) => issue.is_private !== true);

        await sequential(visible, (issue) => {
          const url = new URL(`issues/${issue.id}`, root).href;
          const text = [
            `⏳ Due tomorrow: [#${issue.id}](${url}) ${issue.subject}`,
            issue.assigned_to?.name,
          ]
            .filter(Boolean)
            .join(' · ');

          return sendOnce(ctx, subscription, {
            key: `due:${issue.id}:${tomorrow}`,
            text,
          });
        });
      });

      return { rescheduleAt: nextDailyRun(zone, deadlineHour) };
    },
  });

  return {
    jobs: [pollJob, deadlineJob],
    start: async (ctx: AppContext) => {
      await ctx.scheduler.schedule(
        pollJob,
        {},
        { runAt: new Date(Date.now() + 10_000), key: pollKey },
      );
      await ctx.scheduler.schedule(
        deadlineJob,
        {},
        {
          runAt: nextDailyRun(ctx.config.DEFAULT_TIMEZONE, deadlineHour),
          key: deadlineKey,
        },
      );
    },
  };
}
