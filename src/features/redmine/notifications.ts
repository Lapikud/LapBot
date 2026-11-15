import { MessageFlags } from 'discord.js';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { defineJob } from '../../core/define.js';
import type { AppContext } from '../../core/feature.js';
import type {
  RedmineClient,
  RedmineStatus,
} from '../../integrations/redmine/client.js';
import { nextDailyRun } from '../../shared/time.js';
import type { RedmineSubscription } from './schema.js';
import {
  claimNotification,
  issueNotifications,
  listSubscriptions,
  setCheckpoint,
} from './service.js';

const pollIntervalMs = 2 * 60 * 1000;
const issuesPerPoll = 25;
const deadlineHour = 9;

export const pollKey = 'redmine:poll';
export const deadlineKey = 'redmine:deadlines';

async function forEachSubscription(
  ctx: AppContext,
  handle: (subscription: RedmineSubscription) => Promise<void>,
): Promise<void> {
  let afterId = 0;
  for (;;) {
    const page = await listSubscriptions(ctx.db, afterId);
    for (const subscription of page) {
      try {
        await handle(subscription);
      } catch (error) {
        ctx.log.warn(
          { err: error, subscriptionId: subscription.id },
          'Redmine subscription update failed',
        );
      }
    }
    const last = page.at(-1);
    if (last === undefined) {
      return;
    }
    afterId = last.id;
  }
}

async function sendOnce(
  ctx: AppContext,
  subscription: RedmineSubscription,
  key: string,
  text: string,
) {
  if (!(await claimNotification(ctx.db, subscription.id, key))) {
    return;
  }
  const channel = await ctx.client.channels.fetch(subscription.channelId);
  if (channel?.isSendable() === true) {
    await channel.send({
      content: text.slice(0, 2000),
      allowedMentions: { parse: [] },
      flags: MessageFlags.SuppressEmbeds,
    });
  }
}

/**
 * Incremental polling: each subscription remembers the newest update it has
 * processed and only asks Redmine for issues updated since. Notifications
 * are claimed in the database before sending, so none repeat.
 */
async function pollSubscription(
  ctx: AppContext,
  redmine: RedmineClient,
  baseUrl: string,
  subscription: RedmineSubscription,
  statuses: ReadonlyMap<number, RedmineStatus>,
): Promise<void> {
  const { issues } = await redmine.listIssues({
    projectId: subscription.projectId,
    status: '*',
    updatedSince: subscription.checkpoint,
    sort: 'updated_on:asc',
    limit: issuesPerPoll,
  });
  let checkpoint = subscription.checkpoint;
  for (const summary of issues) {
    const issue = await redmine.getIssue(summary.id, true);
    const url = new URL(`issues/${issue.id}`, baseUrl).href;
    for (const notification of issueNotifications(
      issue,
      subscription.checkpoint,
      statuses,
      url,
    )) {
      await sendOnce(ctx, subscription, notification.key, notification.text);
    }
    const updated = new Date(issue.updated_on);
    if (updated > checkpoint) {
      checkpoint = updated;
    }
  }
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
      // Without statuses, notifications show "?" names instead of failing.
      const known = await redmine.listStatuses().catch(() => []);
      const statuses = new Map(known.map((status) => [status.id, status]));
      await forEachSubscription(ctx, (subscription) =>
        pollSubscription(ctx, redmine, root, subscription, statuses),
      );
      return { rescheduleAt: new Date(Date.now() + pollIntervalMs) };
    },
  });

  const deadlineJob = defineJob({
    type: 'redmine:deadlines',
    payload: z.object({}),
    handle: async (_payload, _info, ctx) => {
      const zone = ctx.config.DEFAULT_TIMEZONE;
      const tomorrow =
        DateTime.now().setZone(zone).plus({ days: 1 }).toISODate() ?? '';
      await forEachSubscription(ctx, async (subscription) => {
        const { issues } = await redmine.listIssues({
          projectId: subscription.projectId,
          dueDate: tomorrow,
          limit: 50,
        });
        for (const issue of issues.filter((i) => i.is_private !== true)) {
          const url = new URL(`issues/${issue.id}`, root).href;
          await sendOnce(
            ctx,
            subscription,
            `due:${issue.id}:${tomorrow}`,
            [
              `⏳ Due tomorrow: [#${issue.id}](${url}) ${issue.subject}`,
              issue.assigned_to?.name,
            ]
              .filter(Boolean)
              .join(' · '),
          );
        }
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
