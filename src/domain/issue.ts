export type Named = { id: number; name: string };

export type TrackerUser = {
  id: number;
  login: string;
  firstname?: string;
  lastname?: string;
};

export type TrackerProject = {
  id: number;
  name: string;
  identifier: string;
  description?: string | null;
};

export type IssueStatus = Named & { is_closed?: boolean };

export type JournalDetail = {
  property: string;
  name: string;
  old_value?: string | null;
  new_value?: string | null;
};

export type Journal = {
  id: number;
  user?: Named;
  notes?: string | null;
  private_notes?: boolean;
  created_on: string;
  details: JournalDetail[];
};

export type Issue = {
  id: number;
  project: Named;
  tracker: Named;
  status: IssueStatus;
  priority: Named;
  author: Named;
  assigned_to?: Named;
  subject: string;
  description?: string | null;
  due_date?: string | null;
  done_ratio?: number;
  is_private?: boolean;
  created_on: string;
  updated_on: string;
  journals?: Journal[];
};

export type IssueQuery = {
  projectId?: number | string;
  assignedToMe?: boolean;
  status?: 'open' | 'closed' | '*';
  updatedSince?: Date;
  dueDate?: string;
  sort?: string;
  offset?: number;
  limit?: number;
};

export type IssueChanges = {
  subject?: string;
  description?: string;
  status_id?: number;
  assigned_to_id?: number;
  notes?: string;
};

export type IntegrationErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'unavailable'
  | 'invalid_response';

export class IntegrationError extends Error {
  override readonly name = 'IntegrationError';

  constructor(
    readonly kind: IntegrationErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type Notification = { key: string; text: string };

export function issueNotifications(
  issue: Issue,
  since: Date,
  statuses: ReadonlyMap<number, IssueStatus>,
  issueUrl: string,
): Notification[] {
  if (issue.is_private === true) {
    return [];
  }

  const title = `[#${issue.id}](${issueUrl}) ${issue.subject}`;
  const notifications: Notification[] = [];

  if (new Date(issue.created_on) >= since) {
    const assignee = issue.assigned_to
      ? `, assigned to ${issue.assigned_to.name}`
      : '';

    notifications.push({
      key: `issue:${issue.id}:created`,
      text: `🆕 ${issue.tracker.name} ${title} by ${issue.author.name}${assignee}`,
    });
  }

  for (const journal of issue.journals ?? []) {
    if (
      new Date(journal.created_on) < since ||
      journal.private_notes === true
    ) {
      continue;
    }

    const changes = journal.details.flatMap((detail) => {
      if (detail.property !== 'attr') {
        return [];
      }

      if (detail.name === 'status_id') {
        const name = (id?: string | null) =>
          statuses.get(Number(id))?.name ?? '?';

        return [`status ${name(detail.old_value)} → ${name(detail.new_value)}`];
      }

      if (detail.name === 'assigned_to_id') {
        const matches =
          issue.assigned_to &&
          String(issue.assigned_to.id) === detail.new_value;

        return [
          matches === true
            ? `assigned to ${issue.assigned_to?.name ?? ''}`
            : 'assignee changed',
        ];
      }

      return [];
    });
    const notes = journal.notes?.trim() ?? '';

    if (changes.length === 0 && notes === '') {
      continue;
    }

    const who = journal.user?.name ?? 'Someone';
    const comment =
      notes === '' ? '' : `\n> ${notes.slice(0, 300).replaceAll('\n', '\n> ')}`;

    notifications.push({
      key: `journal:${journal.id}`,
      text: `✏️ ${title}: ${[who, ...changes].join(' · ')}${comment}`,
    });
  }

  return notifications;
}
