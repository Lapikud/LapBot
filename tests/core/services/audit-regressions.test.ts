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

});
