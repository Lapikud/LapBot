import { describe, expect, it, vi } from 'vitest';
import type { IssueTracker } from '~/integrations/redmine/contract';
import type { Scheduler } from '~/core/scheduler';
import { createRedmineService } from '~/features/redmine/service';
import { IntegrationError, type Issue } from '~/integrations/redmine/model';
import { UserError } from '~/core/errors';
import { createTrackerRepository } from '~/features/redmine/repository';
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
    listProjects: vi.fn(async () => ({
      projects: [{ id: 1, name: 'Web', identifier: 'web' }],
      total: 1,
    })),
    listIssues: vi.fn(async () => ({ issues: [issue], total: 1 })),
    getIssue: vi.fn(async () => issue),
    listStatuses: vi.fn(async () => []),
    ...overrides,
  };
}

describe.skipIf(noDatabase)('redmine service', () => {
  const setup = (client = tracker()) => {
    const { messenger } = fakeMessenger();
    const service = createRedmineService({
      baseUrl: 'https://r',
      client,
      tracker: createTrackerRepository(testDb()),
      scheduler: {
        schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
        cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
      },
      messenger,
      authz: allowAll,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    });

    return { service, messenger };
  };

  it('subscribes a channel to a project found by identifier', async () => {
    const { service } = setup();
    const member = actor({ guildId: snowflake(), userId: snowflake() });
    const channelId = snowflake();

    await expect(service.subscribe(member, channelId, 'nope')).rejects.toThrow(
      UserError,
    );

    const first = await service.subscribe(member, channelId, 'web');
    const again = await service.subscribe(member, channelId, '1');

    expect(first).toMatchObject({ project: { id: 1 }, added: true });
    expect(again.added).toBe(false);
    expect((await service.unsubscribe(member, channelId, 'web')).removed).toBe(
      true,
    );
  });

  it('turns tracker failures into user-facing errors', async () => {
    const failing = tracker({
      listProjects: vi.fn(async () => {
        throw new IntegrationError('forbidden', 'Not allowed.');
      }),
    });
    const { service } = setup(failing);
    const member = actor({ guildId: snowflake(), userId: snowflake() });

    await expect(service.subscribe(member, snowflake(), 'web')).rejects.toThrow(
      UserError,
    );
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
    const outcome = await poll?.run({});

    await poll?.run({});

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
        listIssues: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    );

    await expect(service.jobs[0]?.run({})).resolves.toBeDefined();
  });
});
