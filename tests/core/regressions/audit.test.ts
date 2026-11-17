import { describe, expect, it, vi } from 'vitest';
import { createPostService } from '~/core/posts';
import { createAuthorizer } from '~/core/authorization';
import { createBirthdayService } from '~/core/birthdays';
import { createRedmineService } from '~/core/redmine';
import {
  createPostRepository,
  createBirthdayRepository,
  createGrantRepository,
  createTrackerRepository,
} from '~/infra/db';
import type { Issue } from '~/domain/issues';
import type { Permission } from '~/domain';
import type { IssueTracker, Scheduler } from '~/core/ports';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';

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
  const announcements = createPostRepository(testDb());
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
    announcementService: createPostService({
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

  it('accepts a safe birthday role below the manager', async () => {
    const { member, directory, birthdays, birthdayService } = await setup([
      'birthday:manage',
    ]);

    directory.role.mockResolvedValue(role());
    await birthdayService.configure(member, { channelId: 'c', roleId: 'r' });
    expect(await birthdays.settings(member.guildId)).toMatchObject({
      channelId: 'c',
      roleId: 'r',
    });
  });

  it('hides private-channel announcements even from publishers', async () => {
    const { member, directory, announcements, announcementService } =
      await setup(['announcement:publish']);
    const draft = await announcements.insert({
      guildId: member.guildId,
      authorId: 'other',
      channelId: 'private',
      title: 'Secret',
      content: 'Hidden',
      mentionRoleIds: [],
      mentionEveryone: false,
    });

    directory.canView.mockResolvedValue(false);
    await expect(announcementService.get(member, draft.id)).rejects.toThrow(
      'does not exist',
    );
    expect(await announcementService.list(member)).toEqual([]);
  });

  it('hides another author’s drafts but keeps their published announcements visible', async () => {
    const { member, announcements, announcementService } = await setup();
    const draft = await announcements.insert({
      guildId: member.guildId,
      authorId: 'other',
      channelId: 'c',
      title: 'Unpublished',
      content: 'Hidden',
      mentionRoleIds: [],
      mentionEveryone: false,
    });

    await expect(announcementService.get(member, draft.id)).rejects.toThrow();
    expect(await announcementService.list(member)).toEqual([]);
    await announcements.update(draft.id, { status: 'published' });
    expect(
      (await announcementService.list(member)).map((row) => row.id),
    ).toEqual([draft.id]);
  });

  it('lets authors and publishers read visible drafts', async () => {
    const { member, announcements, announcementService } = await setup([
      'announcement:publish',
    ]);
    const draft = await announcements.insert({
      guildId: member.guildId,
      authorId: 'author',
      channelId: 'c',
      title: null,
      content: 'Draft',
      mentionRoleIds: [],
      mentionEveryone: false,
    });

    expect((await announcementService.get(member, draft.id)).id).toBe(draft.id);
    expect(
      (
        await announcementService.get(
          actor({ guildId: member.guildId, userId: 'author' }),
          draft.id,
        )
      ).id,
    ).toBe(draft.id);
  });

  it.each(['channel', 'everyone', 'role'] as const)(
    'rechecks %s restrictions before publishing',
    async (restriction) => {
      const {
        member,
        directory,
        announcements,
        announcementService,
        messages,
      } = await setup(['announcement:publish']);
      const draft = await announcements.insert({
        guildId: member.guildId,
        authorId: 'other',
        channelId: 'c',
        title: null,
        content: 'Draft',
        mentionRoleIds: restriction === 'role' ? ['r'] : [],
        mentionEveryone: restriction === 'everyone',
      });

      directory.canPost.mockResolvedValue(restriction !== 'channel');
      directory.role.mockResolvedValue(role({ mentionable: false }));
      await expect(
        announcementService.publish(member, draft.id),
      ).rejects.toThrow();
      expect(messages.size).toBe(0);
      expect((await announcements.find(draft.id))?.status).toBe('draft');
    },
  );
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

  it('sends deadline notifications from every page', async () => {
    const issues = Array.from({ length: 51 }, (_, index) => ({
      ...dueIssue,
      id: index + 1,
    }));
    const { service, messages, channelId } = await redmineSetup(issues);

    await service.jobs[1]?.run({});
    expect(
      [...messages.values()].filter(
        (message) => message.channelId === channelId,
      ),
    ).toHaveLength(51);
  });

  it('retries failed deadlines for their original date after midnight', async () => {
    const { service, messenger, messages, channelId, queue, client } =
      await redmineSetup([dueIssue]);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-16T23:59:00Z'));
      messenger.send.mockRejectedValueOnce(new Error('Temporary outage'));
      await service.jobs[1]?.run({});
      const retry = queue.schedule.mock.calls[0];

      expect(retry).toBeDefined();
      expect(retry?.[1]).toMatchObject({ dueDate: '2026-11-17' });
      expect(retry?.[2].runAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 120_000,
      );
      vi.setSystemTime(new Date('2026-11-17T00:01:00Z'));
      await service.jobs[1]?.run(retry?.[1]);
      await service.jobs[1]?.run(retry?.[1]);
      expect(client.listIssues).toHaveBeenLastCalledWith(
        expect.objectContaining({ dueDate: '2026-11-17' }),
      );
      expect(
        [...messages.values()].filter(
          (message) => message.channelId === channelId,
        ),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
