import type { Issue, IssueQuery, IssueStatus, TrackerProject } from './model';

export type IssueTracker = {
  listProjects: (
    offset?: number,
    limit?: number,
  ) => Promise<{ projects: TrackerProject[]; total: number }>;
  listIssues: (
    query?: IssueQuery,
  ) => Promise<{ issues: Issue[]; total: number }>;
  getIssue: (id: number, withJournals?: boolean) => Promise<Issue>;
  listStatuses: () => Promise<IssueStatus[]>;
};
