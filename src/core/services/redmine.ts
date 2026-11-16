import { z } from 'zod';
import {
  addCalendarDays,
  calendarDay,
  formatCalendarDay,
  IntegrationError,
  issueNotifications,
  nextDailyRun,
  UserError,
  type IssueStatus,
  type Notification,
} from '~/domain';
import type {
  Authorizer,
  IssueTracker,
  Job,
  Logger,
  Messenger,
  Scheduler,
  Subscription,
  TrackerRepository,
} from '~/core/ports';
import { sequential } from '~/lib';
import { guard } from './guard';
import { defineJob } from './jobs';

const pollIntervalMs = 2 * 60 * 1000;
const issuesPerPoll = 25;
const deadlineHour = 9;

type Deps = {
  baseUrl: string;
  client: IssueTracker;
  tracker: TrackerRepository;
  scheduler: Scheduler;
  messenger: Messenger;
  authz: Authorizer;
  log: Logger;
  timezone: string;
};

export function createRedmineService(deps: Deps) {
  const { client, tracker, messenger, authz, log } = deps;
  const root = deps.baseUrl.endsWith('/') ? deps.baseUrl : `${deps.baseUrl}/`;
  const issueUrl = (id: number) => `${root}issues/${id}`;

  const sendOnce = async (
    subscription: Subscription,
    notification: Notification,
  ) => {
    if (!(await tracker.claimNotification(subscription.id, notification.key))) {
      return;
    }

    try {
      await messenger.send(subscription.channelId, {
        content: notification.text.slice(0, 2000),
        suppressEmbeds: true,
      });
    } catch (error) {
      await tracker.releaseNotification(subscription.id, notification.key);
      throw error;
    }
  };

  const forEachSubscription = async (
    handle: (subscription: Subscription) => Promise<void>,
    afterId = 0,
  ): Promise<void> => {
    const page = await tracker.subscriptions(afterId);

    await sequential(page, async (subscription) => {
      try {
        await handle(subscription);
      } catch (error) {
        log.warn(
          { err: error, subscriptionId: subscription.id },
          'Redmine subscription update failed',
        );
      }
    });

    const last = page.at(-1);

    if (last !== undefined) {
      await forEachSubscription(handle, last.id);
    }
  };

  const pollSubscription = async (
    subscription: Subscription,
    statuses: ReadonlyMap<number, IssueStatus>,
  ) => {
    let checkpoint = subscription.checkpoint;
    const pollPage = async (offset = 0): Promise<void> => {
      const { issues, total } = await client.listIssues({
        projectId: subscription.projectId,
        status: '*',
        updatedSince: subscription.checkpoint,
        sort: 'updated_on:asc,id:asc',
        limit: issuesPerPoll,
        offset,
      });

      await sequential(issues, async (summary) => {
        const issue = await client.getIssue(summary.id, true);
        const notifications = issueNotifications(
          issue,
          subscription.checkpoint,
          statuses,
          issueUrl(issue.id),
        );

        await sequential(notifications, (notification) =>
          sendOnce(subscription, notification),
        );

        const updated = new Date(summary.updated_on);

        if (updated > checkpoint) {
          checkpoint = updated;
        }
      });

      const nextOffset = offset + issues.length;

      if (issues.length > 0 && nextOffset < total) {
        await pollPage(nextOffset);
      }
    };

    await pollPage();

    if (checkpoint > subscription.checkpoint) {
      await tracker.setCheckpoint(subscription.id, checkpoint);
    }
  };

  const pollJob = defineJob({
    type: 'redmine.poll',
    payload: z.object({}),
    handle: async () => {
      const known = await client.listStatuses().catch(() => []);
      const statuses = new Map(known.map((status) => [status.id, status]));

      await forEachSubscription((subscription) =>
        pollSubscription(subscription, statuses),
      );

      return { rescheduleAt: new Date(Date.now() + pollIntervalMs) };
    },
  });

  const deadlineJob: Job<{ dueDate?: string; subscriptionId?: number }> =
    defineJob({
      type: 'redmine.deadlines',
      payload: z.object({
        dueDate: z.iso.date().exactOptional(),
        subscriptionId: z.number().int().positive().exactOptional(),
      }),
      handle: async ({ dueDate, subscriptionId }) => {
        const tomorrow =
          dueDate ??
          formatCalendarDay(
            addCalendarDays(calendarDay(new Date(), deps.timezone), 1),
          );

        await forEachSubscription(async (subscription) => {
          if (
            subscriptionId !== undefined &&
            subscription.id !== subscriptionId
          ) {
            return;
          }

          const pollPage = async (offset = 0): Promise<void> => {
            const { issues, total } = await client.listIssues({
              projectId: subscription.projectId,
              dueDate: tomorrow,
              limit: 50,
              sort: 'id:asc',
              offset,
            });
            const visible = issues.filter((issue) => issue.is_private !== true);

            await sequential(visible, (issue) =>
              sendOnce(subscription, {
                key: `due:${issue.id}:${tomorrow}`,
                text: [
                  `⏳ Due tomorrow: [#${issue.id}](${issueUrl(issue.id)}) ${issue.subject}`,
                  issue.assigned_to?.name,
                ]
                  .filter(Boolean)
                  .join(' · '),
              }),
            );
            const nextOffset = offset + issues.length;

            if (issues.length > 0 && nextOffset < total) {
              await pollPage(nextOffset);
            }
          };

          try {
            await pollPage();
          } catch (error) {
            await deps.scheduler.schedule(
              deadlineJob,
              { dueDate: tomorrow, subscriptionId: subscription.id },
              {
                runAt: new Date(Date.now() + pollIntervalMs),
                key: `redmine:deadlines:${subscription.id}:${tomorrow}`,
              },
            );
            throw error;
          }
        });

        return dueDate === undefined
          ? { rescheduleAt: nextDailyRun(deps.timezone, deadlineHour) }
          : null;
      },
    });

  const project = async (identifier: string) => {
    try {
      const { projects } = await client.listProjects(0, 100);
      const found = projects.find(
        (p) => p.identifier === identifier || String(p.id) === identifier,
      );

      if (!found) {
        throw new UserError(`Project "${identifier}" not found.`);
      }

      return found;
    } catch (error) {
      if (error instanceof IntegrationError) {
        log.warn({ kind: error.kind }, 'Redmine request failed');

        throw new UserError(error.message);
      }

      throw error;
    }
  };

  return {
    jobs: [pollJob, deadlineJob],
    start: async () => {
      await deps.scheduler.schedule(
        pollJob,
        {},
        { runAt: new Date(Date.now() + 10_000), key: 'redmine:poll' },
      );
      await deps.scheduler.schedule(
        deadlineJob,
        {},
        {
          runAt: nextDailyRun(deps.timezone, deadlineHour),
          key: 'redmine:deadlines',
        },
      );
    },
    subscribe: guard(
      authz,
      'redmine:subscription:manage',
      async (actor, channelId: string, identifier: string) => {
        const found = await project(identifier);
        const added = await tracker.subscribe({
          guildId: actor.guildId,
          channelId,
          projectId: found.id,
          projectName: found.name,
          createdBy: actor.userId,
        });

        log.info(
          {
            guildId: actor.guildId,
            channelId,
            projectId: found.id,
            actorId: actor.userId,
          },
          'Redmine subscription added',
        );

        return { project: found, added };
      },
    ),
    unsubscribe: guard(
      authz,
      'redmine:subscription:manage',
      async (actor, channelId: string, identifier: string) => {
        const found = await project(identifier);

        return {
          project: found,
          removed: await tracker.unsubscribe(
            actor.guildId,
            channelId,
            found.id,
          ),
        };
      },
    ),
  };
}

export type RedmineService = ReturnType<typeof createRedmineService>;
