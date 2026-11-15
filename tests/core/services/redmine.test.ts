import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { IssueTracker, Scheduler } from '~/core/ports';
import { createRedmineService, type ReminderService } from '~/core/services';
import { IntegrationError, UserError, type Issue } from '~/domain';
import { createSecretBox } from '~/infra/crypto';
import { createTrackerRepository } from '~/infra/db';
import { noDatabase, snowflake, testDb } from '../../db';
import { actor, allowAll, fakeMessenger, silentLog } from '../../fakes';

const since = new Date('2026-11-10T00:00:00Z');
const issue: Issue = {
  id: 42,
  project: { id: 1, name: 'Web' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 2, name: 'In Progress' },
  priority: { id: 2, name: 'Normal' },
  author: { id: 3, name: 'Mari' },
  subject: 'Fix login',
  created_on: '2026-11-11T10:00:00Z',
  updated_on: '2026-11-12T10:00:00Z',
  journals: [
    { id: 7, notes: 'hi', created_on: '2026-11-12T10:00:00Z', details: [] },
  ],
};

function tracker(overrides: Partial<IssueTracker> = {}): IssueTracker {
  return {
    currentUser: vi.fn(async () => ({ id: 5, login: 'mari' })),
    listProjects: vi.fn(async () => ({
      projects: [{ id: 1, name: 'Web', identifier: 'web' }],
      total: 1,
    })),
    listIssues: vi.fn(async () => ({ issues: [issue], total: 1 })),
    getIssue: vi.fn(async () => issue),
    listStatuses: vi.fn(async () => []),
    createIssue: vi.fn(async () => issue),
    updateIssue: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe.skipIf(noDatabase)('redmine service', () => {
  const setup = (client = tracker()) => {
    const { messenger } = fakeMessenger();
    const connect = vi.fn(() => client);
    const service = createRedmineService({
      baseUrl: 'https://r',
      connect,
      service: client,
      tracker: createTrackerRepository(testDb()),
      secrets: createSecretBox(randomBytes(32).toString('base64')),
      reminders: {} as ReminderService,
      scheduler: {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      },
      messenger,
      authz: allowAll,
      log: silentLog,
      defaultTimezone: 'Europe/Tallinn',
      timezone: async () => 'Europe/Tallinn',
    });

    return { service, messenger, connect, client };
  };

  it('requires a linked account and uses that key for user actions', async () => {
    const { service, connect } = setup();
    const member = actor({ guildId: snowflake(), userId: snowflake() });

    await expect(service.projects(member)).rejects.toThrow(
      'Link your Redmine account',
    );
    await service.link(member, 'k'.repeat(40));
    await service.projects(member);
    expect(connect).toHaveBeenLastCalledWith('k'.repeat(40));
  });

  it('turns tracker failures into user-facing errors', async () => {
    const failing = tracker({
      listProjects: vi.fn(async () =>
        { throw new IntegrationError('forbidden', 'Not allowed.'); },
      ),
    });
    const { service } = setup(failing);
    const member = actor({ guildId: snowflake(), userId: snowflake() });

    await service.link(member, 'k'.repeat(40));
    await expect(service.projects(member)).rejects.toThrow(UserError);
  });

  it('notifies once per change and advances the checkpoint', async () => {
    const { service, messenger } = setup();
    const repository = createTrackerRepository(testDb());
    const channelId = snowflake();

    await repository.subscribe({
      guildId: snowflake(),
      channelId,
      projectId: 1,
      projectName: 'Web',
      createdBy: 'u',
    });

    const subscription = (await repository.subscriptions(0, 1000)).find(
      (s) => s.channelId === channelId,
    );

    await repository.setCheckpoint(subscription?.id ?? 0, since);

    const [poll] = service.jobs;
    const info = { id: 1, runAt: new Date(), attempt: 1 };
    const outcome = await poll?.run({}, info);

    await poll?.run({}, info);

    const ours = messenger.send.mock.calls.filter(([id]) => id === channelId);

    expect(ours).toHaveLength(2);
    expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());

    const updated = (await repository.subscriptions(0, 1000)).find(
      (s) => s.channelId === channelId,
    );

    expect(updated?.checkpoint.toISOString()).toBe('2026-11-12T10:00:00.000Z');
  });

  it('keeps going when one subscription fails', async () => {
    const { service } = setup(
      tracker({
        listIssues: vi.fn(async () => { throw new Error('boom'); }),
      }),
    );

    await expect(
      service.jobs[0]?.run({}, { id: 1, runAt: new Date(), attempt: 1 }),
    ).resolves.toBeDefined();
  });
});
