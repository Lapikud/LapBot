import { describe, expect, it } from 'vitest';
import {
  createAnnouncementService,
  createAuthorizer,
  createBirthdayService,
} from '~/core/services';
import {
  createAnnouncementRepository,
  createBirthdayRepository,
  createGrantRepository,
} from '~/infra/db';
import type { Permission } from '~/domain';
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
      announcements,
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
