import { describe, expect, it } from 'vitest';
import { checkDelegation } from '~/core/helpers/permissions';
import type { Actor } from '~/core/actor';

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  guildId: 'g',
  userId: 'u',
  roleIds: [],
  administrator: false,
  owner: false,
  mentionEveryone: false,
  highestRolePosition: 5,
  ...overrides,
});

describe('checkDelegation', () => {
  it('lets administrators grant anything', () => {
    expect(() =>
      checkDelegation({
        actor: actor({ administrator: true }),
        rolePosition: 99,
        permission: 'permissions:manage',
        actorHolds: false,
      }),
    ).not.toThrow();
  });

  it('never lets managers hand out permission management', () => {
    expect(() =>
      checkDelegation({
        actor: actor(),
        rolePosition: 1,
        permission: 'permissions:manage',
        actorHolds: true,
      }),
    ).toThrow('Only administrators');
  });

  it('only allows held permissions, for roles below the manager', () => {
    const grant = (rolePosition: number, actorHolds: boolean) => () =>
      checkDelegation({
        actor: actor(),
        rolePosition,
        permission: 'event:create',
        actorHolds,
      });

    expect(grant(1, true)).not.toThrow();
    expect(grant(1, false)).toThrow('hold yourself');
    expect(grant(5, true)).toThrow('below');
  });
});
