import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Job, Scheduler } from '~/core/ports/scheduler';
import { createJobQueue, startJobs } from '~/integrations/scheduler/boss';
import { noDatabase, snowflake, testDb } from './db';
import {
  silentLog,
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  role,
  denyAll,
} from './fakes';
import { announcementView } from '~/features/announcements/message';
import type { Announcement } from '~/features/announcements/model';
import { createAnnouncementRepository } from '~/features/announcements/repository';
import { createAnnouncementService } from '~/features/announcements/service';
import { PermanentError, UserError } from '~/core/errors';
import type { Permission } from '~/core/permission';
import { createGrantRepository } from '~/features/permissions/repository';
import { createAuthorizer } from '~/features/permissions/service';
import { createBirthdayService } from '~/features/birthdays/service';
import { calendarDay } from '~/core/helpers/time';
import { createBirthdayRepository } from '~/features/birthdays/repository';
import { createReminderRepository } from '~/features/reminders/repository';
import { createReminderService } from '~/features/reminders/service';
import type { Issue, IssueTracker } from '~/core/ports/issue-tracker';
import { createTrackerRepository } from '~/features/redmine/repository';
import { createRedmineService } from '~/features/redmine/service';

describe('job queue', () => {
  describe.skipIf(noDatabase)('pg-boss scheduler', () => {
    let boss: PgBoss;
    let scheduler: ReturnType<typeof createJobQueue>;
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const idle: Job<{ n: number }> = {
      type: 'test-idle',
      run: async () => null,
    };
    const queued = async (job: Job<{ n: number }>, key: string) =>
      boss.findJobs<{ n: number }>(job.type, { key, queued: true });

    beforeAll(async () => {
      boss = new PgBoss(process.env.TEST_DATABASE_URL ?? '');
      scheduler = createJobQueue(boss);
      await boss.start();
      await startJobs(boss, [idle], silentLog);
    });

    afterAll(async () => {
      await boss.stop();
    });

    it('keeps one queued job per key and cancels it', async () => {
      await scheduler.schedule(idle, { n: 1 }, { runAt: later, key: 'a' });
      await scheduler.schedule(idle, { n: 2 }, { runAt: later, key: 'a' });

      const jobs = await queued(idle, 'a');

      expect(jobs.map((job) => job.data.n)).toEqual([2]);

      await scheduler.cancel(idle, 'a');
      expect(await queued(idle, 'a')).toHaveLength(0);
    });
  });
});

describe('announcement publication', () => {
  const sample = (overrides: Partial<Announcement> = {}): Announcement => ({
    id: 1,
    guildId: 'g',
    authorId: 'a',
    channelId: 'c',
    title: 'Hello',
    content: 'World',
    mentionRoleIds: [],
    mentionEveryone: false,
    status: 'draft',
    scheduledAt: null,
    publishedAt: null,
    messageId: null,
    failure: null,
    createdAt: new Date(),
    ...overrides,
  });

  describe('announcement view', () => {
    it('only pings the chosen roles or everyone, never text in the body', () => {
      expect(
        announcementView(sample({ content: '@everyone hi' })).mentions,
      ).toEqual({
        everyone: false,
        roles: [],
      });
      expect(
        announcementView(sample({ mentionRoleIds: ['r1', 'r2'] })),
      ).toMatchObject({
        content: '<@&r1> <@&r2>\n# Hello\nWorld',
        mentions: { roles: ['r1', 'r2'] },
      });
      expect(
        announcementView(sample({ mentionEveryone: true })).mentions?.everyone,
      ).toBe(true);
    });
  });

  describe.skipIf(noDatabase)('announcement service', () => {
    const setup = () => {
      const { messenger } = fakeMessenger();
      const scheduler = {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      };
      const repository = createAnnouncementRepository(testDb());
      const service = createAnnouncementService({
        posts: repository,
        scheduler,
        messenger,
        directory: fakeDirectory(
          [role({ id: 'team' }), role({ id: 'secret', mentionable: false })],
          { canPost: true },
        ),
        authz: allowAll,
        log: silentLog,
        clock: { now: () => new Date() },
        timezone: 'Europe/Tallinn',
      });

      return {
        service,
        messenger,
        repository,
        author: actor({ guildId: snowflake() }),
      };
    };

    it('publishes due scheduled announcements once', async () => {
      const { service, messenger, repository, author } = setup();
      const draft = await service.draft(author, {
        channelId: 'c',
        content: 'Hi',
      });
      const job = service.jobs[0];

      await repository.update(draft.id, {
        status: 'scheduled',
        scheduledAt: new Date(),
      });
      await job?.run({ announcementId: draft.id });
      await job?.run({ announcementId: draft.id });
      expect(messenger.send).toHaveBeenCalledOnce();
      expect((await repository.find(draft.id))?.status).toBe('published');
    });
  });
});

describe('announcement lifecycle', () => {
  describe.skipIf(noDatabase)('managed post API', () => {
    const setup = async (
      permissions: Permission[] = [
        'announcement:create',
        'announcement:publish',
        'announcement:schedule',
      ],
    ) => {
      const author = actor({ guildId: snowflake(), roleIds: ['staff'] });
      const grants = createGrantRepository(testDb());

      for (const permission of permissions) {
        await grants.grant({
          guildId: author.guildId,
          roleId: 'staff',
          permission,
          grantedBy: 'admin',
        });
      }

      const authz = createAuthorizer(grants);
      const posts = createAnnouncementRepository(testDb());
      const directory = fakeDirectory([
        role({ id: 'team' }),
        role({ id: 'secret', mentionable: false }),
      ]);
      const { messenger } = fakeMessenger();
      const scheduler = {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      };
      let now = new Date('2026-11-17T12:00:00Z');
      const service = createAnnouncementService({
        posts,
        authz,
        directory,
        messenger,
        scheduler,
        log: silentLog,
        clock: { now: () => now },
        timezone: 'UTC',
      });
      const draft = () =>
        service.draft(author, {
          channelId: 'c',
          content: 'Hello',
          mentionRoleIds: ['team'],
        });

      return {
        service,
        author,
        posts,
        directory,
        messenger,
        scheduler,
        draft,
        advance: (date: Date) => {
          now = date;
        },
      };
    };

    it('uses the post lifecycle directly and never repeats mentions on edits', async () => {
      const { service, author, posts, messenger, draft } = await setup();
      const post = await draft();

      await service.publish(author, post.id);
      await service.edit(author, post.id, { content: 'Updated' });
      expect(await posts.find(post.id)).toMatchObject({
        status: 'published',
        content: 'Updated',
      });
      expect(messenger.edit.mock.calls[0]?.[2].mentions).toEqual({});
      await expect(service.publish(author, post.id)).rejects.toThrow(
        'already published',
      );
    });

    it('hides other communities invisible channels and another authors drafts', async () => {
      const { service, author, posts, directory, draft } = await setup([]);
      const post = await posts.insert({
        guildId: author.guildId,
        authorId: 'other',
        channelId: 'c',
        title: null,
        content: 'Hidden',
        mentionRoleIds: [],
        mentionEveryone: false,
      });

      await expect(service.get(author, post.id)).rejects.toThrow(
        'does not exist',
      );
      await expect(
        service.edit(author, post.id, { content: 'Changed' }),
      ).rejects.toThrow();
      await expect(
        service.get(actor({ guildId: 'other' }), post.id),
      ).rejects.toThrow();
      directory.canView.mockResolvedValue(false);
      await expect(
        service.get({ ...author, userId: 'other' }, post.id),
      ).rejects.toThrow();
      expect(await service.list(author)).toEqual([]);
      await expect(draft()).rejects.toThrow();
    });

    it('requires publication and scheduling permissions even for the author', async () => {
      const { service, author, draft } = await setup(['announcement:create']);
      const post = await draft();

      await expect(service.publish(author, post.id)).rejects.toThrow();
      await expect(service.schedule(author, post.id, '1h')).rejects.toThrow();
      await service.cancel(author, post.id);
      await expect(service.cancel(author, post.id)).rejects.toThrow(
        'already cancelled',
      );
    });

    it('rechecks channel access and mention permissions before publication', async () => {
      const { service, author, directory, draft } = await setup();

      await expect(
        service.draft(author, {
          channelId: 'c',
          content: 'x',
          mentionEveryone: true,
        }),
      ).rejects.toThrow('everyone');
      await expect(
        service.draft(author, {
          channelId: 'c',
          content: 'x',
          mentionRoleIds: ['secret'],
        }),
      ).rejects.toThrow('may not mention');
      const post = await draft();

      directory.canPost.mockResolvedValue(false);
      await expect(service.publish(author, post.id)).rejects.toThrow(
        'cannot post',
      );
    });

    it('allows one concurrent publication and records the resulting reference', async () => {
      const { service, author, posts, messenger, draft } = await setup();
      const post = await draft();
      const attempts = await Promise.allSettled([
        service.publish(author, post.id),
        service.publish(author, post.id),
      ]);

      expect(
        attempts.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(messenger.send).toHaveBeenCalledOnce();
      expect((await posts.find(post.id))?.messageId).toBeDefined();
    });

    it('restores scheduled state on transient failure and draft on permanent failure', async () => {
      const { service, author, posts, messenger, advance, draft } =
        await setup();
      const post = await draft();

      await service.schedule(author, post.id, '1h');
      advance(new Date('2026-11-17T13:00:00Z'));
      messenger.send.mockRejectedValueOnce(new Error('temporary'));
      await expect(
        service.jobs[0]?.run({ announcementId: post.id }),
      ).rejects.toThrow('temporary');
      expect(await posts.find(post.id)).toMatchObject({
        status: 'scheduled',
        publishedAt: null,
        failure: 'temporary',
      });
      messenger.send.mockRejectedValueOnce(
        new PermanentError('deleted channel'),
      );
      await expect(
        service.jobs[0]?.run({ announcementId: post.id }),
      ).rejects.toThrow('deleted channel');
      expect(await posts.find(post.id)).toMatchObject({
        status: 'draft',
        publishedAt: null,
      });
    });
  });
});

describe('birthday announcements', () => {
  describe.skipIf(noDatabase)('birthdays', () => {
    const repository = () => createBirthdayRepository(testDb());
    const today = { year: 2027, month: 2, day: 28 };

    it('announces each birthday once per year and respects privacy', async () => {
      const birthdays = repository();
      const guildId = snowflake();
      const [pub, announce, priv, leap, other] = [
        snowflake(),
        snowflake(),
        snowflake(),
        snowflake(),
        snowflake(),
      ];

      await birthdays.set({
        guildId,
        userId: pub,
        month: 2,
        day: 28,
        visibility: 'public',
      });
      await birthdays.set({
        guildId,
        userId: announce,
        month: 2,
        day: 28,
        visibility: 'announce',
      });
      await birthdays.set({
        guildId,
        userId: priv,
        month: 2,
        day: 28,
        visibility: 'private',
      });
      await birthdays.set({
        guildId,
        userId: leap,
        month: 2,
        day: 29,
        visibility: 'public',
      });
      await birthdays.set({
        guildId,
        userId: other,
        month: 3,
        day: 1,
        visibility: 'public',
      });

      const claimed = await birthdays.claim(guildId, today);

      expect(claimed).toHaveLength(3);
      expect(claimed).toEqual(expect.arrayContaining([pub, announce, leap]));
      expect(await birthdays.claim(guildId, today)).toEqual([]);
      expect(
        await birthdays.claim(guildId, { ...today, year: 2028 }),
      ).toHaveLength(2);
    });

    it('can release a claim after a failed post', async () => {
      const birthdays = repository();
      const guildId = snowflake();
      const user = snowflake();

      await birthdays.set({
        guildId,
        userId: user,
        month: 2,
        day: 28,
        visibility: 'public',
      });
      await birthdays.claim(guildId, today);
      await birthdays.release(guildId, [user], today.year);
      expect(await birthdays.claim(guildId, today)).toEqual([user]);
    });

    it('lists only public birthdays, starting from today', async () => {
      const birthdays = repository();
      const guildId = snowflake();
      const [jan, jun, dec, hidden] = [
        snowflake(),
        snowflake(),
        snowflake(),
        snowflake(),
      ];

      await birthdays.set({
        guildId,
        userId: jan,
        month: 1,
        day: 5,
        visibility: 'public',
      });
      await birthdays.set({
        guildId,
        userId: jun,
        month: 6,
        day: 5,
        visibility: 'public',
      });
      await birthdays.set({
        guildId,
        userId: dec,
        month: 12,
        day: 5,
        visibility: 'public',
      });
      await birthdays.set({
        guildId,
        userId: hidden,
        month: 6,
        day: 6,
        visibility: 'announce',
      });

      const list = await birthdays.upcoming(guildId, {
        year: 2026,
        month: 6,
        day: 1,
      });

      expect(list.map((b) => b.userId)).toEqual([jun, dec, jan]);
    });

    it('posts one message per day and reschedules', async () => {
      const { messenger } = fakeMessenger();
      const scheduler = {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      };
      const service = createBirthdayService({
        birthdays: repository(),
        scheduler,
        messenger,
        directory: fakeDirectory(),
        authz: allowAll,
        log: silentLog,
        timezone: 'Europe/Tallinn',
      });
      const admin = actor({ guildId: snowflake(), userId: snowflake() });
      const now = calendarDay(new Date(), 'Europe/Tallinn');

      await service.set(admin, { day: now.day, month: now.month });
      await service.configure(admin, { channelId: 'c' });

      const [daily] = service.jobs;
      const outcome = await daily?.run({ guildId: admin.guildId });

      await daily?.run({ guildId: admin.guildId });
      expect(messenger.send).toHaveBeenCalledOnce();
      expect(messenger.send).toHaveBeenCalledWith(
        'c',
        expect.objectContaining({ mentions: { users: [admin.userId] } }),
      );
      expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('hides non-public birthdays from other members', async () => {
      const service = createBirthdayService({
        birthdays: repository(),
        scheduler: {
          schedule: async () => undefined,
          cancel: async () => undefined,
        },
        messenger: fakeMessenger().messenger,
        directory: fakeDirectory(),
        authz: allowAll,
        log: silentLog,
        timezone: 'Europe/Tallinn',
      });
      const owner = actor({ guildId: snowflake(), userId: snowflake() });

      await service.set(owner, { day: 1, month: 5, visibility: 'announce' });
      expect(await service.view(owner, owner.userId)).toBeDefined();
      expect(
        await service.view(actor({ guildId: owner.guildId }), owner.userId),
      ).toBeUndefined();
    });
  });
});

describe('reminders', () => {
  describe.skipIf(noDatabase)('reminder service', () => {
    const setup = (authz = allowAll) => {
      const { messenger } = fakeMessenger();
      const scheduler = {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      };
      const repository = createReminderRepository(testDb());
      const service = createReminderService({
        reminders: repository,
        scheduler,
        messenger,
        directory: fakeDirectory(),
        authz,
        timezone: 'Europe/Tallinn',
      });
      const [deliver] = service.jobs;

      return {
        service,
        messenger,
        scheduler,
        repository,
        deliver,
        member: actor({ guildId: snowflake(), userId: snowflake() }),
      };
    };

    it('delivers one-off reminders by DM and completes them', async () => {
      const { service, messenger, repository, deliver, member } = setup();
      const reminder = await service.create(member, {
        when: '10m',
        message: 'stand-up',
      });

      expect(await deliver?.run({ reminderId: reminder.id })).toBeNull();
      expect(messenger.direct).toHaveBeenCalledWith(member.userId, {
        content: '⏰ **Reminder:** stand-up',
      });
      expect((await repository.find(reminder.id))?.status).toBe('done');
    });

    it('skips cancelled reminders and only lets owners manage them', async () => {
      const { service, messenger, deliver, member } = setup();
      const reminder = await service.create(member, {
        when: '10m',
        message: 'x',
      });

      await expect(
        service.cancel(actor({ guildId: member.guildId }), reminder.id),
      ).rejects.toBeInstanceOf(UserError);
      await service.cancel(member, reminder.id);
      await deliver?.run({ reminderId: reminder.id });
      expect(messenger.direct).not.toHaveBeenCalled();
    });

    it('requires permission for channel reminders', async () => {
      const { service, member } = setup(denyAll);

      await expect(
        service.create(member, { when: '10m', message: 'x', channelId: 'c' }),
      ).rejects.toThrow('denied');
    });
  });
});

describe('Redmine notifications', () => {
  const since = new Date('2026-11-10T00:00:00Z');
  const issue: Issue = {
    id: 42,
    project: { id: 1, name: 'Web' },
    tracker: { id: 1, name: 'Bug' },
    status: { id: 2, name: 'In Progress' },
    priority: { id: 2, name: 'Normal' },
    author: { id: 3, name: 'Mari' },
    subject: 'Fix login',
    created_on: '2026-11-11T10:00:00Z',
    updated_on: '2026-11-12T10:00:00Z',
    journals: [
      { id: 7, notes: 'hi', created_on: '2026-11-12T10:00:00Z', details: [] },
    ],
  };

  function tracker(overrides: Partial<IssueTracker> = {}): IssueTracker {
    return {
      listProjects: vi.fn(async () => ({
        projects: [{ id: 1, name: 'Web', identifier: 'web' }],
        total: 1,
      })),
      listIssues: vi.fn(async () => ({ issues: [issue], total: 1 })),
      getIssue: vi.fn(async () => issue),
      listStatuses: vi.fn(async () => []),
      ...overrides,
    };
  }

  describe.skipIf(noDatabase)('redmine service', () => {
    const setup = (client = tracker()) => {
      const { messenger } = fakeMessenger();
      const service = createRedmineService({
        baseUrl: 'https://r',
        client,
        tracker: createTrackerRepository(testDb()),
        scheduler: {
          schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
          cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
        },
        messenger,
        authz: allowAll,
        log: silentLog,
        timezone: 'Europe/Tallinn',
      });

      return { service, messenger };
    };

    it('notifies once per change and advances the checkpoint', async () => {
      const { service, messenger } = setup();
      const repository = createTrackerRepository(testDb());
      const channelId = snowflake();

      await repository.subscribe({
        guildId: snowflake(),
        channelId,
        projectId: 1,
        projectName: 'Web',
        createdBy: 'u',
      });

      const subscription = (await repository.subscriptions(0, 1000)).find(
        (s) => s.channelId === channelId,
      );

      await repository.setCheckpoint(subscription?.id ?? 0, since);

      const [poll] = service.jobs;
      const outcome = await poll?.run({});

      await poll?.run({});

      const ours = messenger.send.mock.calls.filter(([id]) => id === channelId);

      expect(ours).toHaveLength(2);
      expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());

      const updated = (await repository.subscriptions(0, 1000)).find(
        (s) => s.channelId === channelId,
      );

      expect(updated?.checkpoint.toISOString()).toBe(
        '2026-11-12T10:00:00.000Z',
      );
    });
  });
});

describe('Redmine retries', () => {
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

      return {
        service,
        messenger,
        messages,
        channelId,
        tracker,
        queue,
        client,
      };
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
});
