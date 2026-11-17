import { beforeAll, describe, expect, it } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import { createAuthorizer } from '~/features/permissions/service';
import type { Actor } from '~/core/actor';
import {
  createGrantRepository,
  grant,
  listGrants,
  revoke,
} from '~/features/permissions/repository';

function member(
  guildId: string,
  roleIds: string[],
  administrator = false,
): Actor {
  return {
    guildId,
    userId: 'u',
    roleIds,
    administrator,
    owner: false,
    mentionEveryone: false,
    highestRolePosition: 1,
  };
}

describe.skipIf(noDatabase)('authorizer', () => {
  const guildId = snowflake();
  const otherGuild = snowflake();
  const organizers = snowflake();
  const helpers = snowflake();

  beforeAll(async () => {
    const db = testDb();

    await grant(db, {
      guildId,
      roleId: organizers,
      permission: 'event:create',
      grantedBy: 'x',
    });
    await grant(db, {
      guildId,
      roleId: helpers,
      permission: 'poll:create',
      grantedBy: 'x',
    });
  });

  it('denies by default and allows granted roles', async () => {
    const authz = createAuthorizer(createGrantRepository(testDb()));

    expect(await authz.can(member(guildId, []), 'event:create')).toBe(false);
    expect(await authz.can(member(guildId, [organizers]), 'event:create')).toBe(
      true,
    );
    expect(await authz.can(member(guildId, [organizers]), 'poll:create')).toBe(
      false,
    );
  });

  it('combines grants from all roles of a member', async () => {
    const authz = createAuthorizer(createGrantRepository(testDb()));
    const both = member(guildId, [organizers, helpers]);

    expect(await authz.can(both, 'event:create')).toBe(true);
    expect(await authz.can(both, 'poll:create')).toBe(true);
  });

  it('isolates grants per guild', async () => {
    const authz = createAuthorizer(createGrantRepository(testDb()));

    expect(
      await authz.can(member(otherGuild, [organizers]), 'event:create'),
    ).toBe(false);
  });

  it('lets Discord administrators do everything', async () => {
    const authz = createAuthorizer(createGrantRepository(testDb()));

    expect(
      await authz.can(member(guildId, [], true), 'permissions:manage'),
    ).toBe(true);
  });

  it('stops allowing after revocation', async () => {
    const db = testDb();
    const authz = createAuthorizer(createGrantRepository(db));
    const role = snowflake();

    expect(
      await grant(db, {
        guildId,
        roleId: role,
        permission: 'movie:manage',
        grantedBy: 'x',
      }),
    ).toBe(true);
    expect(
      await grant(db, {
        guildId,
        roleId: role,
        permission: 'movie:manage',
        grantedBy: 'x',
      }),
    ).toBe(false);
    expect(await listGrants(db, guildId, role)).toEqual([
      { roleId: role, permission: 'movie:manage' },
    ]);
    expect(
      await revoke(db, { guildId, roleId: role, permission: 'movie:manage' }),
    ).toBe(true);
    expect(await authz.can(member(guildId, [role]), 'movie:manage')).toBe(
      false,
    );
  });
});

describe.skipIf(noDatabase)('atomic permission replacement', () => {
  it('rolls back revocations when a grant fails', async () => {
    const repo = createGrantRepository(testDb());
    const guildId = snowflake();
    const roleId = snowflake();

    await repo.grant({
      guildId,
      roleId,
      permission: 'event:create',
      grantedBy: 'u',
    });
    await expect(
      repo.apply({
        guildId,
        roleId,
        grantedBy: null as unknown as string,
        grant: ['poll:create'],
        revoke: ['event:create'],
      }),
    ).rejects.toThrow();
    expect(await repo.list(guildId, roleId)).toEqual([
      { roleId, permission: 'event:create' },
    ]);
    await repo.apply({
      guildId,
      roleId,
      grantedBy: 'u',
      grant: ['poll:create'],
      revoke: ['event:create'],
    });
    expect(await repo.list(guildId, roleId)).toEqual([
      { roleId, permission: 'poll:create' },
    ]);
  });
});
