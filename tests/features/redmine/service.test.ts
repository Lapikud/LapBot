import { describe, expect, it, vi } from 'vitest';
import type { Issue, IssueTracker } from '~/core/ports/issue-tracker';
import type { Scheduler } from '~/core/ports/scheduler';
import { createTrackerRepository } from '~/features/redmine/repository';
import { createRedmineService } from '~/features/redmine/service';
import { noDatabase, snowflake, testDb } from '../../db';
import { allowAll, fakeMessenger, silentLog } from '../../fakes';

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
});
