import { describe, expect, it, vi } from 'vitest';
import type { Permission } from '~/core/permission';
import type { Issue, IssueTracker } from '~/core/ports/issue-tracker';
import type { Scheduler } from '~/core/ports/scheduler';
import { createAnnouncementRepository } from '~/features/announcements/repository';
import { createAnnouncementService } from '~/features/announcements/service';
import { createBirthdayRepository } from '~/features/birthdays/repository';
import { createBirthdayService } from '~/features/birthdays/service';
import { createGrantRepository } from '~/features/permissions/repository';
import { createAuthorizer } from '~/features/permissions/service';
import { createTrackerRepository } from '~/features/redmine/repository';
import { createRedmineService } from '~/features/redmine/service';
import { noDatabase, snowflake, testDb } from '../db';
import { actor, fakeDirectory, fakeMessenger, role, silentLog } from '../fakes';

const scheduler = {
  schedule: async () => undefined,
  cancel: async () => undefined,
};

async function setup(permissions: Permission[] = []) {
  const member = actor({ guildId: snowflake(), roleIds: ['staff'] });
  const grants = createGrantRepository(testDb());

  for (const permission of permissions) {
    await grants.grant({
      guildId: member.guildId,
      roleId: 'staff',
      permission,
      grantedBy: 'admin',
    });
  }

  const directory = fakeDirectory();
  const { messenger, messages } = fakeMessenger();
  const authz = createAuthorizer(grants);
  const announcements = createAnnouncementRepository(testDb());
  const birthdays = createBirthdayRepository(testDb());
  const shared = {
    scheduler,
    directory,
    messenger,
    authz,
    log: silentLog,
    timezone: 'UTC',
  };

  return {
    member,
    directory,
    messenger,
    messages,
    announcements,
    birthdays,
    announcementService: createAnnouncementService({
      ...shared,
      posts: announcements,
      clock: { now: () => new Date() },
    }),
    birthdayService: createBirthdayService({ ...shared, birthdays }),
  };
}

describe.skipIf(noDatabase)('audit security regressions', () => {
  it.each([
    { administrator: true, moderator: true },
    { moderator: true },
    { position: 10 },
    { position: 11 },
  ])('rejects unsafe birthday roles: %j', async (overrides) => {
    const { member, directory, birthdays, birthdayService } = await setup([
      'birthday:manage',
    ]);

    directory.role.mockResolvedValue(role(overrides));
    await expect(
      birthdayService.configure(member, { channelId: 'c', roleId: 'r' }),
    ).rejects.toThrow();
    expect(await birthdays.settings(member.guildId)).toBeUndefined();
  });

  it('rejects birthday channels the manager cannot post in', async () => {
    const { member, directory, birthdays, birthdayService } = await setup([
      'birthday:manage',
    ]);

    directory.canPost.mockResolvedValue(false);
    await expect(
      birthdayService.configure(member, { channelId: 'private' }),
    ).rejects.toThrow();
    expect(await birthdays.settings(member.guildId)).toBeUndefined();
  });
});

const dueIssue: Issue = {
  id: 1,
  project: { id: 1, name: 'Project' },
  tracker: { id: 1, name: 'Task' },
  status: { id: 1, name: 'Open' },
  priority: { id: 1, name: 'Normal' },
  author: { id: 1, name: 'Author' },
  subject: 'Due tomorrow',
  created_on: '2026-11-01T00:00:00Z',
  updated_on: '2026-11-01T00:00:00Z',
};

describe.skipIf(noDatabase)('audit Redmine regressions', () => {
  async function redmineSetup(issues: Issue[]) {
    const repository = createTrackerRepository(testDb());
    const channelId = snowflake();
    const tracker = {
      ...repository,
      subscriptions: async (afterId?: number) =>
        (await repository.subscriptions(afterId, 1000)).filter(
          (subscription) => subscription.channelId === channelId,
        ),
    };
    const queue = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: async () => undefined,
    };
    const { messenger, messages } = fakeMessenger();
    const client: IssueTracker = {
      listProjects: async () => ({ projects: [], total: 0 }),
      listStatuses: async () => [],
      getIssue: async () => dueIssue,
      listIssues: vi.fn<IssueTracker['listIssues']>(async (query) => ({
        issues: issues.slice(
          query?.offset ?? 0,
          (query?.offset ?? 0) + (query?.limit ?? 25),
        ),
        total: issues.length,
      })),
    };

    await tracker.subscribe({
      guildId: snowflake(),
      channelId,
      projectId: 1,
      projectName: 'Project',
      createdBy: 'u',
    });
    const service = createRedmineService({
      baseUrl: 'https://example.test',
      client,
      tracker,
      messenger,
      scheduler: queue,
      authz: createAuthorizer(createGrantRepository(testDb())),
      log: silentLog,
      timezone: 'UTC',
    });

    return { service, messenger, messages, channelId, tracker, queue, client };
  }

  it('retries a failed notification and deduplicates the successful delivery', async () => {
    const { service, messenger, messages, channelId, tracker } =
      await redmineSetup([dueIssue]);
    const subscription = (await tracker.subscriptions(0)).find(
      (row) => row.channelId === channelId,
    );

    await tracker.setCheckpoint(
      subscription?.id ?? 0,
      new Date('2026-10-01T00:00:00Z'),
    );
    messenger.send.mockRejectedValueOnce(new Error('Temporary outage'));
    await service.jobs[0]?.run({});
    await service.jobs[0]?.run({});
    await service.jobs[0]?.run({});
    expect(
      [...messages.values()].filter(
        (message) => message.channelId === channelId,
      ),
    ).toHaveLength(1);
  });
});
