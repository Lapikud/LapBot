import { noDatabase, snowflake, testDb } from './db';
import { createGrantRepository } from '~/integrations/db/permissions/repository';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import {
  configureApplicationAdminRole,
  toActor,
  toRoleInfo,
} from '~/discord/interactions/actor';
import { createAuthorizer } from '~/features/permissions/service';
import type { GrantRepository } from '~/features/permissions/model';
import { actor } from './fakes';
import { applicationAdmin } from '~/core/permission';

function discordMember(roles: string[], discordAdmin = false): GuildMember {
  return {
    id: 'member',
    guild: { id: 'guild', ownerId: 'owner' },
    roles: {
      cache: new Map(roles.map((id) => [id, {}])),
      highest: { position: 2 },
    },
    permissions: {
      has: (flag: bigint) =>
        discordAdmin && flag === PermissionFlagsBits.Administrator,
    },
  } as unknown as GuildMember;
}

afterEach(() => configureApplicationAdminRole());

describe('application administrators', () => {
  it('follows current Juhatus membership within the configured guild', () => {
    configureApplicationAdminRole('juhatus', 'guild');
    expect(toActor(discordMember(['juhatus'])).administrator).toBe(true);
    expect(toActor(discordMember([])).administrator).toBe(false);
    expect(toActor(discordMember([], true)).administrator).toBe(true);
    configureApplicationAdminRole('juhatus', 'different');
    expect(toActor(discordMember(['juhatus'])).administrator).toBe(false);
  });

  it('prevents Juhatus being exposed as a self-assignable role', () => {
    configureApplicationAdminRole('juhatus', 'guild');
    const info = toRoleInfo({
      id: 'juhatus',
      guild: { id: 'guild' },
      permissions: { has: () => false },
    } as unknown as Parameters<typeof toRoleInfo>[0]);

    expect(info.moderator).toBe(true);
  });
});

it('includes personal grants in both authorization lookups', async () => {
  const holds = vi.fn(async () => true);
  const held = vi.fn(async () => [
    'event:create',
    'poll:create',
    applicationAdmin,
  ]);
  const authz = createAuthorizer({ holds, held } as unknown as GrantRepository);
  const user = actor({ administrator: false, roleIds: ['role'] });

  expect(await authz.can(user, 'event:create')).toBe(true);
  expect(
    await authz.granted(user, [
      'event:create',
      'poll:create',
      applicationAdmin,
    ]),
  ).toEqual(new Set(['event:create', 'poll:create']));
  expect(await authz.can(user, applicationAdmin)).toBe(false);
});

describe.skipIf(noDatabase)('personal grants in PostgreSQL', () => {
  it('unions personal and role permissions without crossing guilds or subject types', async () => {
    const grants = createGrantRepository(testDb());
    const guildId = snowflake();
    const userId = snowflake();
    const roleId = snowflake();
    const member = actor({
      guildId,
      userId,
      roleIds: [roleId],
      administrator: false,
    });
    const authz = createAuthorizer(grants);

    await grants.grant({
      guildId,
      roleId,
      permission: 'event:create',
      grantedBy: 'admin',
    });
    await grants.grant({
      guildId,
      roleId: userId,
      subjectType: 'user',
      permission: 'event:create',
      grantedBy: 'admin',
    });
    await grants.grant({
      guildId,
      roleId: userId,
      subjectType: 'user',
      permission: 'poll:create',
      grantedBy: 'admin',
    });
    expect(
      await authz.granted(member, ['event:create', 'poll:create']),
    ).toEqual(new Set(['event:create', 'poll:create']));
    await grants.revoke({ guildId, roleId, permission: 'event:create' });
    expect(await authz.can(member, 'event:create')).toBe(true);
    expect(
      await authz.can({ ...member, guildId: snowflake() }, 'poll:create'),
    ).toBe(false);
    expect(
      await authz.can(
        { ...member, userId: snowflake(), roleIds: [userId] },
        'poll:create',
      ),
    ).toBe(false);
    await grants.revoke({
      guildId,
      roleId: userId,
      subjectType: 'user',
      permission: 'event:create',
    });
    expect(await authz.can(member, 'event:create')).toBe(false);
  });
});
