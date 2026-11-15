import type { GuildMember, Role } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { Authorizer } from '~/core/feature';
import { checkDelegation } from '~/features/permissions';

const role = {} as Role;
const actor = (options: { admin?: boolean; above?: boolean }) =>
  ({
    permissions: { has: () => options.admin ?? false },
    roles: {
      highest: { comparePositionTo: () => (options.above === false ? 0 : 1) },
    },
  }) as unknown as GuildMember;
const authz = (holds: boolean) => ({
  authz: {
    can: async () => holds,
    require: async () => undefined,
  } as Authorizer,
});

describe('permission delegation', () => {
  it('lets administrators grant anything', async () => {
    await expect(
      checkDelegation(
        authz(false),
        actor({ admin: true }),
        role,
        'permissions:manage',
      ),
    ).resolves.toBeUndefined();
  });

  it('never lets managers hand out permission management', async () => {
    await expect(
      checkDelegation(authz(true), actor({}), role, 'permissions:manage'),
    ).rejects.toThrow('Only administrators');
  });

  it('only allows permissions the manager holds, for roles below them', async () => {
    await expect(
      checkDelegation(authz(true), actor({}), role, 'event:create'),
    ).resolves.toBeUndefined();
    await expect(
      checkDelegation(authz(false), actor({}), role, 'event:create'),
    ).rejects.toThrow('hold yourself');
    await expect(
      checkDelegation(
        authz(true),
        actor({ above: false }),
        role,
        'event:create',
      ),
    ).rejects.toThrow('below');
  });
});
