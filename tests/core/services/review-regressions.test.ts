import { expect, it, vi } from 'vitest';
import type {
  GrantRepository,
} from '~/core/ports';
import { createPermissionService } from '~/core/services';
import type { Permission, PermissionDefinition } from '~/domain';
import {
  actor,
  allowAll,
  fakeDirectory,
  role,
  silentLog,
} from '../../fakes';

it('validates every permission change before writing any', async () => {
  const grants: GrantRepository = {
    holds: async () => false,
    list: async () => [],
    grant: vi.fn(async () => true),
    revoke: vi.fn(async () => true),
    apply: vi.fn(async () => undefined),
  };
  const known = new Map<Permission, PermissionDefinition>([
    ['event:create', { id: 'event:create', description: '' }],
    ['poll:create', { id: 'poll:create', description: '' }],
  ]);
  const service = createPermissionService({
    grants,
    directory: fakeDirectory([role()]),
    log: silentLog,
    known: () => known,
    authz: {
      require: async () => undefined,
      can: async (_actor, p) => p !== 'poll:create',
    },
  });

  await expect(
    service.setRole(actor(), 'r', ['event:create', 'poll:create']),
  ).rejects.toThrow();
  expect(grants.grant).not.toHaveBeenCalled();
  expect(grants.revoke).not.toHaveBeenCalled();
  expect(grants.apply).not.toHaveBeenCalled();
});

it('applies an allowed permission selection in one operation', async () => {
  const grants: GrantRepository = {
    holds: async () => true,
    list: async () => [{ roleId: 'r', permission: 'poll:create' }],
    grant: vi.fn(async () => true),
    revoke: vi.fn(async () => true),
    apply: vi.fn(async () => undefined),
  };
  const service = createPermissionService({
    grants,
    directory: fakeDirectory([role()]),
    authz: allowAll,
    log: silentLog,
    known: () =>
      new Map<Permission, PermissionDefinition>([
        ['event:create', { id: 'event:create', description: '' }],
        ['poll:create', { id: 'poll:create', description: '' }],
      ]),
  });

  await expect(
    service.setRole(actor(), 'r', ['event:create']),
  ).resolves.toEqual({ granted: 1, revoked: 1 });
  expect(grants.apply).toHaveBeenCalledWith({
    guildId: 'g',
    roleId: 'r',
    grantedBy: 'u',
    grant: ['event:create'],
    revoke: ['poll:create'],
  });
  expect(grants.grant).not.toHaveBeenCalled();
  expect(grants.revoke).not.toHaveBeenCalled();
});
