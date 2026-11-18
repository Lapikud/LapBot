import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '~/core/ports/scheduler';
import type { Sent } from '~/core/ports/messenger';
import { createJobQueue, startJobs } from '~/integrations/scheduler/boss';
import { noDatabase, snowflake, testDb } from './db';
import {
  silentLog,
  actor,
  serviceFakes,
  allowAll,
  fakeDirectory,
  role,
  denyAll,
} from './fakes';
import { announcementView } from '~/features/announcements/message';
import type { Announcement } from '~/features/announcements/model';
import { createAnnouncementRepository } from '~/integrations/db/announcements/repository';
import { createAnnouncementService } from '~/features/announcements/service';
import { PermanentError, UserError } from '~/core/errors';
import type { Permission } from '~/core/permission';
import { createGrantRepository } from '~/integrations/db/permissions/repository';
import { createAuthorizer } from '~/features/permissions/service';
import { createBirthdayService } from '~/features/birthdays/service';
import { calendarDay } from '~/core/helpers/time';
import { createBirthdayRepository } from '~/integrations/db/birthdays/repository';
import { createReminderRepository } from '~/integrations/db/reminders/repository';
import { createReminderService } from '~/features/reminders/service';

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
    status: 'draft',
    scheduledAt: null,
    publishedAt: null,
    messageIds: [],
    failure: null,
    createdAt: new Date(),
    ...overrides,
  });

  describe('announcement view', () => {
    it('only pings the chosen roles, never text in the body', () => {
      expect(
        announcementView(sample({ content: '@everyone hi' }))[0]?.mentions,
      ).toEqual({ roles: [] });
      expect(
        announcementView(sample({ mentionRoleIds: ['r1', 'r2'] }))[0],
      ).toMatchObject({
        content: '<@&r1> <@&r2>\n# Hello\nWorld',
        mentions: { roles: ['r1', 'r2'] },
      });
    });
  });

  describe.skipIf(noDatabase)('announcement service', () => {
    const setup = () => {
      const shared = serviceFakes();
      const { messenger } = shared;
      const repository = createAnnouncementRepository(testDb());
      const directory = fakeDirectory(
        [role({ id: 'team' }), role({ id: 'secret', mentionable: false })],
        { canPost: true },
      );

      directory.member.mockImplementation(async (guildId, userId) =>
        actor({ guildId, userId }),
      );
      const service = createAnnouncementService({
        ...shared,
        posts: repository,
        directory,
        clock: { now: () => new Date() },
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

      directory.member.mockResolvedValue(author);
      const shared = serviceFakes();
      const { messenger, scheduler } = shared;
      let now = new Date('2026-11-17T12:00:00Z');
      const service = createAnnouncementService({
        ...shared,
        posts,
        authz,
        directory,
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

    it('rejects edits after create permission is revoked', async () => {
      const { service, author, draft } = await setup();
      const post = await draft();
      const grants = createGrantRepository(testDb());

      await grants.revoke({
        guildId: author.guildId,
        roleId: 'staff',
        permission: 'announcement:create',
      });
      await expect(
        service.edit(author, post.id, { content: 'Changed' }),
      ).rejects.toThrow('announcement:create');
    });

    it('does not publish after scheduling permission is revoked', async () => {
      const { service, author, posts, messenger, draft, advance } =
        await setup();
      const post = await draft();

      await service.schedule(author, post.id, '1h');
      advance(new Date('2026-11-17T13:00:00Z'));
      await createGrantRepository(testDb()).revoke({
        guildId: author.guildId,
        roleId: 'staff',
        permission: 'announcement:schedule',
      });
      await service.jobs[0]?.run({ announcementId: post.id });
      expect(messenger.send).not.toHaveBeenCalled();
      expect(await posts.find(post.id)).toMatchObject({ status: 'draft' });
    });

    it('does not publish after destination access is revoked', async () => {
      const { service, author, directory, posts, messenger, draft, advance } =
        await setup();
      const post = await draft();

      await service.schedule(author, post.id, '1h');
      advance(new Date('2026-11-17T13:00:00Z'));
      directory.canPost.mockResolvedValue(false);
      await service.jobs[0]?.run({ announcementId: post.id });
      expect(messenger.send).not.toHaveBeenCalled();
      expect(await posts.find(post.id)).toMatchObject({ status: 'draft' });
    });

    it('does not publish after the author leaves', async () => {
      const { service, author, directory, posts, messenger, draft, advance } =
        await setup();
      const post = await draft();

      await service.schedule(author, post.id, '1h');
      advance(new Date('2026-11-17T13:00:00Z'));
      directory.member.mockResolvedValue(undefined);
      await service.jobs[0]?.run({ announcementId: post.id });
      expect(messenger.send).not.toHaveBeenCalled();
      expect(await posts.find(post.id)).toMatchObject({ status: 'draft' });
    });

    it('retries transient membership lookup failures', async () => {
      const { service, author, directory, posts, draft, advance } =
        await setup();
      const post = await draft();

      await service.schedule(author, post.id, '1h');
      advance(new Date('2026-11-17T13:00:00Z'));
      directory.member.mockRejectedValue(new Error('Discord unavailable'));
      await expect(
        service.jobs[0]?.run({ announcementId: post.id }),
      ).rejects.toThrow('Discord unavailable');
      expect(await posts.find(post.id)).toMatchObject({ status: 'scheduled' });
    });

    it('splits long announcements, pinging only the first message', async () => {
      const { service, author, messenger, posts } = await setup();
      const created = await service.draft(author, {
        channelId: 'c',
        content: `${'a '.repeat(1200)}\n${'b '.repeat(700)}`,
        mentionRoleIds: ['team'],
      });
      const published = await service.publish(author, created.id);
      const sent = messenger.send.mock.calls.map(([, message]) => message);

      expect(sent).toHaveLength(2);
      expect(sent[0]?.mentions?.roles).toEqual(['team']);
      expect(sent[1]?.mentions).toEqual({});
      expect(
        sent.every((message) => (message.content?.length ?? 0) <= 2000),
      ).toBe(true);
      expect(published.messageIds).toHaveLength(2);

      await service.edit(author, created.id, { content: 'Short now' });
      expect(messenger.remove).toHaveBeenCalledWith(
        'c',
        published.messageIds[1],
      );
      expect((await posts.find(created.id))?.messageIds).toEqual([
        published.messageIds[0],
      ]);
    });

    it('removes sent parts when a later part fails', async () => {
      const { service, author, messenger, posts } = await setup();
      const created = await service.draft(author, {
        channelId: 'c',
        content: 'x '.repeat(1500),
      });
      const send = messenger.send.getMockImplementation();

      if (send === undefined) {
        throw new Error('Missing send implementation');
      }

      messenger.send
        .mockImplementationOnce(send)
        .mockRejectedValueOnce(new Error('Discord is down'));
      await expect(service.publish(author, created.id)).rejects.toThrow('down');

      const first = (await messenger.send.mock.results[0]?.value) as Sent;

      expect(messenger.remove).toHaveBeenCalledWith('c', first.messageId);
      expect(await posts.find(created.id)).toMatchObject({
        status: 'draft',
        messageIds: [],
      });
    });

    it('rejects an over-long announcement without saving a draft', async () => {
      const { service, author, posts } = await setup();

      await expect(
        service.draft(author, {
          channelId: 'c',
          content: 'x'.repeat(4001),
        }),
      ).rejects.toThrow('Write 1-4000 characters.');
      expect(await posts.list(author.guildId)).toEqual([]);
    });

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
      expect((await posts.find(post.id))?.messageIds).toHaveLength(1);
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
      const shared = serviceFakes();
      const { messenger } = shared;
      const service = createBirthdayService({
        ...shared,
        birthdays: repository(),
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
        ...serviceFakes(),
        birthdays: repository(),
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
      const shared = serviceFakes();
      const { messenger, scheduler } = shared;
      const repository = createReminderRepository(testDb());
      const service = createReminderService({
        ...shared,
        reminders: repository,
        authz,
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
