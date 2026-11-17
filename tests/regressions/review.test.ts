import { expect, it, vi } from 'vitest';
import type { GrantRepository } from '~/features/permissions/model';
import type { IssueTracker } from '~/integrations/redmine/contract';
import type { TrackerRepository } from '~/features/redmine/model';
import { createPermissionService } from '~/features/permissions/service';
import { createRedmineService } from '~/features/redmine/service';
import type { Issue } from '~/integrations/redmine/model';
import type { Permission, PermissionDefinition } from '~/foundation/permission';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../fakes';

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

it('processes all pages at an inclusive checkpoint before advancing it', async () => {
  const checkpoint = new Date('2026-11-10T00:00:00Z');
  const updated = '2026-11-12T00:00:00Z';
  const issues = Array.from(
    { length: 26 },
    (_, id) => ({ id: id + 1, updated_on: updated }) as Issue,
  );
  const client: IssueTracker = {
    listProjects: async () => ({ projects: [], total: 0 }),
    listStatuses: async () => [],
    listIssues: vi.fn<IssueTracker['listIssues']>(async (q) => ({
      issues: issues.slice(q?.offset ?? 0, (q?.offset ?? 0) + 25),
      total: 26,
    })),
    getIssue: vi.fn(
      async (id) => ({ ...issues[id - 1], is_private: true }) as Issue,
    ),
  };
  const tracker: TrackerRepository = {
    subscribe: async () => true,
    unsubscribe: async () => true,
    subscriptions: async (after) =>
      after !== undefined && after > 0
        ? []
        : [
            {
              id: 1,
              guildId: 'g',
              channelId: 'c',
              projectId: 1,
              projectName: 'p',
              createdBy: 'u',
              checkpoint,
            },
          ],
    claimNotification: async () => true,
    releaseNotification: async () => undefined,
    setCheckpoint: vi.fn(async () => undefined),
  };
  const service = createRedmineService({
    baseUrl: 'https://example.com',
    client,
    tracker,
    messenger: fakeMessenger().messenger,
    authz: allowAll,
    log: silentLog,
    timezone: 'UTC',
    scheduler: {
      schedule: async () => undefined,
      cancel: async () => undefined,
    },
  });

  await service.jobs[0]?.run({});
  expect(client.getIssue).toHaveBeenCalledTimes(26);
  expect(client.listIssues).toHaveBeenLastCalledWith(
    expect.objectContaining({ offset: 25, updatedSince: checkpoint }),
  );
  expect(tracker.setCheckpoint).toHaveBeenCalledWith(1, new Date(updated));
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
