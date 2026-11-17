export interface IssueTracker {
  listProjects: (
    offset?: number,
    limit?: number,
  ) => Promise<{ projects: TrackerProject[]; total: number }>;
  listIssues: (
    query?: IssueQuery,
  ) => Promise<{ issues: Issue[]; total: number }>;
  getIssue: (id: number, withJournals?: boolean) => Promise<Issue>;
  listStatuses: () => Promise<IssueStatus[]>;
}
export interface Named {
  id: number;
  name: string;
}

export interface TrackerProject {
  id: number;
  name: string;
  identifier: string;
  description?: string | null;
}

export interface IssueStatus extends Named {
  is_closed?: boolean;
}

export interface JournalDetail {
  property: string;
  name: string;
  old_value?: string | null;
  new_value?: string | null;
}

export interface Journal {
  id: number;
  user?: Named;
  notes?: string | null;
  private_notes?: boolean;
  created_on: string;
  details: JournalDetail[];
}

export interface Issue {
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
}

export interface IssueQuery {
  projectId?: number | string;
  status?: 'open' | 'closed' | '*';
  updatedSince?: Date;
  dueDate?: string;
  sort?: string;
  offset?: number;
  limit?: number;
}

export type IntegrationErrorKind =
  'auth' | 'forbidden' | 'not_found' | 'unavailable' | 'invalid_response';

export class IntegrationError extends Error {
  override readonly name = 'IntegrationError';

  constructor(
    readonly kind: IntegrationErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface Notification {
  key: string;
  text: string;
}
