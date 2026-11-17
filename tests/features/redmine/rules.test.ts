import { describe, expect, it } from 'vitest';
import type { Issue } from '~/core/ports/issue-tracker';
import { issueNotifications } from '~/features/redmine/rules';

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
