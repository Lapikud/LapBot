import type { GuildMember } from 'discord.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import { UserError } from '~/domain';
import { createAuthorizer } from '~/infra/discord';
import { grant, listGrants, revoke } from '~/infra/db';

function member(
  guildId: string,
  roleIds: string[],
  admin = false,
): GuildMember {
  return {
    guild: { id: guildId },
    permissions: { has: () => admin },
    roles: { cache: new Map(roleIds.map((id) => [id, {}])) },
  } as unknown as GuildMember;
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
    const authz = createAuthorizer(testDb());

    expect(await authz.can(member(guildId, []), 'event:create')).toBe(false);
    expect(await authz.can(member(guildId, [organizers]), 'event:create')).toBe(
      true,
    );
    expect(await authz.can(member(guildId, [organizers]), 'poll:create')).toBe(
      false,
    );
  });

  it('combines grants from all roles of a member', async () => {
    const authz = createAuthorizer(testDb());
    const both = member(guildId, [organizers, helpers]);

    expect(await authz.can(both, 'event:create')).toBe(true);
    expect(await authz.can(both, 'poll:create')).toBe(true);
  });

  it('isolates grants per guild', async () => {
    const authz = createAuthorizer(testDb());

    expect(
      await authz.can(member(otherGuild, [organizers]), 'event:create'),
    ).toBe(false);
  });

  it('lets Discord administrators do everything', async () => {
    const authz = createAuthorizer(testDb());

    expect(
      await authz.can(member(guildId, [], true), 'permissions:manage'),
    ).toBe(true);
  });

  it('stops allowing after revocation', async () => {
    const db = testDb();
    const authz = createAuthorizer(db);
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

  it('require throws a user-facing error', async () => {
    const authz = createAuthorizer(testDb());

    await expect(
      authz.require(member(guildId, []), 'event:create'),
    ).rejects.toBeInstanceOf(UserError);
  });
});
