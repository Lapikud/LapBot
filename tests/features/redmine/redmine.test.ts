import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { noDatabase, snowflake, testDb } from '../../db';
import type { Config } from '~/config';
import type { AppContext } from '~/infra/discord';
import type { RedmineClient, RedmineIssue } from '~/infra/redmine';
import { createRedmineFeature } from '~/features/redmine';
import { createNotificationJobs } from '~/features/redmine/notifications';
import {
  addSubscription,
  issueNotifications,
  listSubscriptions,
} from '~/features/redmine/service';

const since = new Date('2026-11-10T00:00:00Z');
const statuses = new Map([
  [1, { id: 1, name: 'New' }],
  [2, { id: 2, name: 'In Progress' }],
]);
const issue = (overrides: Partial<RedmineIssue> = {}): RedmineIssue => ({
  id: 42,
  project: { id: 1, name: 'Web' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 2, name: 'In Progress' },
  priority: { id: 2, name: 'Normal' },
  author: { id: 3, name: 'Mari' },
  assigned_to: { id: 5, name: 'Jaan' },
  subject: 'Fix login',
  created_on: '2026-11-11T10:00:00Z',
  updated_on: '2026-11-12T10:00:00Z',
  journals: [],
  ...overrides,
});
const journal = (id: number, overrides: object) => ({
  id,
  user: { id: 3, name: 'Mari' },
  created_on: '2026-11-12T10:00:00Z',
  details: [],
  ...overrides,
});

describe('issueNotifications', () => {
  it('reports new issues, status changes, assignments and comments', () => {
    const notifications = issueNotifications(
      issue({
        journals: [
          journal(1, {
            details: [
              {
                property: 'attr',
                name: 'status_id',
                old_value: '1',
                new_value: '2',
              },
            ],
          }),
          journal(2, {
            details: [
              {
                property: 'attr',
                name: 'assigned_to_id',
                old_value: null,
                new_value: '5',
              },
            ],
          }),
          journal(3, { notes: 'Looks good' }),
          journal(4, { created_on: '2026-11-01T00:00:00Z', notes: 'old' }),
        ],
      }),
      since,
      statuses,
      'https://r/issues/42',
    );

    expect(notifications.map((n) => n.key)).toEqual([
      'issue:42:created',
      'journal:1',
      'journal:2',
      'journal:3',
    ]);
    expect(notifications[1]?.text).toContain('status New → In Progress');
    expect(notifications[2]?.text).toContain('assigned to Jaan');
    expect(notifications[3]?.text).toContain('> Looks good');
  });

  it('never reveals private issues or private notes', () => {
    expect(
      issueNotifications(issue({ is_private: true }), since, statuses, 'u'),
    ).toEqual([]);
    const notes = issueNotifications(
      issue({
        created_on: '2026-01-01T00:00:00Z',
        journals: [journal(9, { notes: 'secret', private_notes: true })],
      }),
      since,
      statuses,
      'u',
    );

    expect(notes).toEqual([]);
  });
});

describe('createRedmineFeature', () => {
  it('is disabled without a base URL and requires an encryption key with one', () => {
    expect(createRedmineFeature({} as Config)).toBeUndefined();
    expect(() =>
      createRedmineFeature({ REDMINE_BASE_URL: 'https://r' } as Config),
    ).toThrow('CREDENTIAL_ENCRYPTION_KEY');
    const feature = createRedmineFeature({
      REDMINE_BASE_URL: 'https://r',
      CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    } as Config);

    expect(feature?.jobs).toEqual([]);
  });
});

describe.skipIf(noDatabase)('redmine polling', () => {
  it('notifies once per change and advances the checkpoint', async () => {
    const db = testDb();
    const channelId = snowflake();

    await addSubscription(db, {
      guildId: snowflake(),
      channelId,
      projectId: 1,
      projectName: 'Web',
      createdBy: 'u',
      checkpoint: since,
    });
    const full = issue({ journals: [journal(7, { notes: 'hi' })] });
    const redmine = {
      listStatuses: vi.fn(async () => [...statuses.values()]),
      listIssues: vi.fn(async () => ({ issues: [full], total: 1 })),
      getIssue: vi.fn(async () => full),
    } as unknown as RedmineClient;
    const send = vi.fn(async () => undefined);
    const ctx = {
      db,
      log: pino({ level: 'silent' }),
      client: {
        channels: {
          fetch: async (id: string) =>
            id === channelId ? { isSendable: () => true, send } : null,
        },
      },
    } as unknown as AppContext;
    const [poll] = createNotificationJobs(redmine, 'https://r/').jobs;
    const info = { id: 1, runAt: new Date(), attempt: 1 };

    const outcome = await poll?.run({}, info, ctx);

    await poll?.run({}, info, ctx);
    const ours = send.mock.calls.length;

    expect(ours).toBe(2);
    expect(outcome?.rescheduleAt.getTime()).toBeGreaterThan(Date.now());
    const subscriptions = await listSubscriptions(db, 0, 1000);

    expect(
      subscriptions
        .find((s) => s.channelId === channelId)
        ?.checkpoint.toISOString(),
    ).toBe(full.updated_on.replace('Z', '.000Z'));
  });

  it('keeps going when one subscription fails', async () => {
    const db = testDb();
    const redmine = {
      listStatuses: vi.fn(async () => []),
      listIssues: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as RedmineClient;
    const ctx = {
      db,
      log: pino({ level: 'silent' }),
      client: { channels: { fetch: vi.fn() } },
    } as unknown as AppContext;
    const [poll] = createNotificationJobs(redmine, 'https://r/').jobs;

    await expect(
      poll?.run({}, { id: 1, runAt: new Date(), attempt: 1 }, ctx),
    ).resolves.toBeDefined();
  });
});
