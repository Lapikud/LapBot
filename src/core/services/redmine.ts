import { z } from 'zod';
import {
  addCalendarDays,
  calendarDay,
  formatCalendarDay,
  IntegrationError,
  issueNotifications,
  nextDailyRun,
  parseCalendarDay,
  UserError,
  zonedTime,
  type Actor,
  type IssueQuery,
  type IssueStatus,
  type Notification,
  type TrackerUser,
} from '~/domain';
import type {
  Authorizer,
  IssueTracker,
  Logger,
  Messenger,
  Scheduler,
  SecretBox,
  Subscription,
  TrackerRepository,
} from '~/core/ports';
import { sequential } from '~/lib';
import { guard } from './guard';
import { defineJob } from './jobs';
import type { ReminderService } from './reminders';

const pollIntervalMs = 2 * 60 * 1000;
const issuesPerPoll = 25;
const deadlineHour = 9;

export type IssueDraft = {
  project: string;
  subject: string;
  description?: string;
  assignToMe?: boolean;
};

type Deps = {
  baseUrl: string;
  connect: (apiKey: string) => IssueTracker;
  service?: IssueTracker | undefined;
  tracker: TrackerRepository;
  secrets: SecretBox;
  reminders: ReminderService;
  scheduler: Scheduler;
  messenger: Messenger;
  authz: Authorizer;
  log: Logger;
  defaultTimezone: string;
  timezone: (guildId: string) => Promise<string>;
};

export function createRedmineService(deps: Deps) {
  const {
    connect,
    service,
    tracker,
    secrets,
    reminders,
    messenger,
    authz,
    log,
  } = deps;
  const root = deps.baseUrl.endsWith('/') ? deps.baseUrl : `${deps.baseUrl}/`;
  const issueUrl = (id: number) => `${root}issues/${id}`;

  const asUser = async <T>(
    actor: Actor,
    run: (client: IssueTracker, redmineUserId: number) => Promise<T>,
  ) => {
    const link = await tracker.link(actor.userId);

    if (!link) {
      throw new UserError(
        'Link your Redmine account first with "/redmine link".',
      );
    }

    try {
      return await run(
        connect(secrets.decrypt(link.encryptedApiKey)),
        link.redmineUserId,
      );
    } catch (error) {
      if (error instanceof IntegrationError) {
        log.warn(
          { kind: error.kind, userId: actor.userId },
          'Redmine request failed',
        );

        throw new UserError(error.message);
      }

      throw error;
    }
  };

  const requireService = () => {
    if (!service) {
      throw new UserError(
        'Redmine notifications are not configured (REDMINE_API_KEY).',
      );
    }

    return service;
  };

  const sendOnce = async (
    subscription: Subscription,
    notification: Notification,
  ) => {
    if (!(await tracker.claimNotification(subscription.id, notification.key))) {
      return;
    }

    await messenger.send(subscription.channelId, {
      content: notification.text.slice(0, 2000),
      suppressEmbeds: true,
    });
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
    client: IssueTracker,
    subscription: Subscription,
    statuses: ReadonlyMap<number, IssueStatus>,
  ) => {
    const { issues } = await client.listIssues({
      projectId: subscription.projectId,
      status: '*',
      updatedSince: subscription.checkpoint,
      sort: 'updated_on:asc',
      limit: issuesPerPoll,
    });
    let checkpoint = subscription.checkpoint;

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

      const updated = new Date(issue.updated_on);

      if (updated > checkpoint) {
        checkpoint = updated;
      }
    });

    if (checkpoint > subscription.checkpoint) {
      await tracker.setCheckpoint(subscription.id, checkpoint);
    }
  };

  const pollJob = defineJob({
    type: 'redmine:poll',
    payload: z.object({}),
    handle: async () => {
      const client = requireService();
      const known = await client.listStatuses().catch(() => []);
      const statuses = new Map(known.map((status) => [status.id, status]));

      await forEachSubscription((subscription) =>
        pollSubscription(client, subscription, statuses),
      );

      return { rescheduleAt: new Date(Date.now() + pollIntervalMs) };
    },
  });

  const deadlineJob = defineJob({
    type: 'redmine:deadlines',
    payload: z.object({}),
    handle: async () => {
      const client = requireService();
      const zone = deps.defaultTimezone;
      const tomorrow = formatCalendarDay(
        addCalendarDays(calendarDay(new Date(), zone), 1),
      );

      await forEachSubscription(async (subscription) => {
        const { issues } = await client.listIssues({
          projectId: subscription.projectId,
          dueDate: tomorrow,
          limit: 50,
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
      });

      return { rescheduleAt: nextDailyRun(zone, deadlineHour) };
    },
  });

  const subscription = async (actor: Actor, identifier: string) =>
    asUser(actor, async (client) => {
      const { projects } = await client.listProjects(0, 100);
      const project = projects.find(
        (p) => p.identifier === identifier || String(p.id) === identifier,
      );

      if (!project) {
        throw new UserError(
          `Project "${identifier}" not found among your projects.`,
        );
      }

      return project;
    });

  return {
    issueUrl,
    jobs: service ? [pollJob, deadlineJob] : [],
    start: async () => {
      if (!service) {
        return;
      }

      await deps.scheduler.schedule(
        pollJob,
        {},
        { runAt: new Date(Date.now() + 10_000), key: 'redmine:poll' },
      );
      await deps.scheduler.schedule(
        deadlineJob,
        {},
        {
          runAt: nextDailyRun(deps.defaultTimezone, deadlineHour),
          key: 'redmine:deadlines',
        },
      );
    },
    link: async (actor: Actor, apiKey: string) => {
      let user: TrackerUser;

      try {
        user = await connect(apiKey.trim()).currentUser();
      } catch (error) {
        if (error instanceof IntegrationError) {
          throw new UserError(
            error.kind === 'auth'
              ? 'Redmine did not accept that API key.'
              : error.message,
          );
        }

        throw error;
      }

      await tracker.saveLink({
        userId: actor.userId,
        redmineUserId: user.id,
        redmineLogin: user.login,
        encryptedApiKey: secrets.encrypt(apiKey.trim()),
      });
      log.info(
        { userId: actor.userId, redmineUserId: user.id },
        'Redmine account linked',
      );

      return user;
    },
    unlink: async (actor: Actor) => {
      const removed = await tracker.unlink(actor.userId);

      log.info({ userId: actor.userId, removed }, 'Redmine account unlinked');

      return removed;
    },
    projects: (actor: Actor) =>
      asUser(actor, (client) => client.listProjects()),
    issues: (actor: Actor, query: IssueQuery) =>
      asUser(actor, (client) => client.listIssues({ ...query, limit: 15 })),
    issue: (actor: Actor, id: number) =>
      asUser(actor, (client) => client.getIssue(id)),
    statuses: (actor: Actor) =>
      asUser(actor, (client) => client.listStatuses()),
    createIssue: guard(
      authz,
      'redmine:issue:create',
      (actor, draft: IssueDraft) =>
        asUser(actor, (client, redmineUserId) =>
          client.createIssue({
            project_id: draft.project,
            subject: draft.subject,
            ...(draft.description !== undefined && {
              description: draft.description,
            }),
            ...(draft.assignToMe === true && { assigned_to_id: redmineUserId }),
          }),
        ),
    ),
    updateIssue: guard(
      authz,
      'redmine:issue:update',
      (actor, id: number, changes: { statusId?: number; notes?: string }) => {
        if (changes.statusId === undefined && changes.notes === undefined) {
          throw new UserError('Give a new status or notes.');
        }

        return asUser(actor, (client) =>
          client.updateIssue(id, {
            ...(changes.statusId !== undefined && {
              status_id: changes.statusId,
            }),
            ...(changes.notes !== undefined && { notes: changes.notes }),
          }),
        );
      },
    ),
    comment: guard(
      authz,
      'redmine:issue:update',
      (actor, id: number, notes: string) =>
        asUser(actor, (client) => client.updateIssue(id, { notes })),
    ),
    assign: guard(
      authz,
      'redmine:issue:assign',
      async (actor, id: number, memberId?: string) => {
        const target =
          memberId === undefined || memberId === actor.userId
            ? undefined
            : await tracker.link(memberId);

        if (memberId !== undefined && memberId !== actor.userId && !target) {
          throw new UserError('That member has not linked a Redmine account.');
        }

        return asUser(actor, (client, redmineUserId) =>
          client.updateIssue(id, {
            assigned_to_id: target?.redmineUserId ?? redmineUserId,
          }),
        );
      },
    ),
    remind: async (actor: Actor, id: number, daysBefore = 1) => {
      const issue = await asUser(actor, (client) => client.getIssue(id));
      const due = parseCalendarDay(issue.due_date ?? '');

      if (!due) {
        throw new UserError(`#${issue.id} has no due date.`);
      }

      const timezone = await deps.timezone(actor.guildId);
      const runAt = zonedTime(addCalendarDays(due, -daysBefore), 9, timezone);

      if (runAt.getTime() <= Date.now()) {
        throw new UserError('That reminder time has already passed.');
      }

      return reminders.schedule({
        guildId: actor.guildId,
        userId: actor.userId,
        channelId: null,
        message: `Redmine #${issue.id} "${issue.subject}" is due ${issue.due_date ?? ''}: ${issueUrl(issue.id)}`,
        runAt,
        recurrence: null,
        timezone,
      });
    },
    subscribe: guard(
      authz,
      'redmine:subscription:manage',
      async (actor, channelId: string, identifier: string) => {
        const project = await subscription(actor, identifier);

        await requireService().listIssues({ projectId: project.id, limit: 1 });

        const added = await tracker.subscribe({
          guildId: actor.guildId,
          channelId,
          projectId: project.id,
          projectName: project.name,
          createdBy: actor.userId,
        });

        log.info(
          {
            guildId: actor.guildId,
            channelId,
            projectId: project.id,
            actorId: actor.userId,
          },
          'Redmine subscription added',
        );

        return { project, added };
      },
    ),
    unsubscribe: guard(
      authz,
      'redmine:subscription:manage',
      async (actor, channelId: string, identifier: string) => {
        const project = await subscription(actor, identifier);

        return {
          project,
          removed: await tracker.unsubscribe(
            actor.guildId,
            channelId,
            project.id,
          ),
        };
      },
    ),
  };
}

export type RedmineService = ReturnType<typeof createRedmineService>;
