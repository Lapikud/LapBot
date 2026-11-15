import { describe, expect, it } from 'vitest';
import { issueNotifications, type Issue } from '~/domain';

const since = new Date('2026-11-10T00:00:00Z');
const statuses = new Map([
  [1, { id: 1, name: 'New' }],
  [2, { id: 2, name: 'In Progress' }],
]);
const issue = (overrides: Partial<Issue> = {}): Issue => ({
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
