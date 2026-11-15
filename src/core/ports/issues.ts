import type {
  Issue,
  IssueChanges,
  IssueQuery,
  IssueStatus,
  TrackerProject,
  TrackerUser,
} from '~/domain';

export type IssueTracker = {
  currentUser: () => Promise<TrackerUser>;
  listProjects: (
    offset?: number,
    limit?: number,
  ) => Promise<{ projects: TrackerProject[]; total: number }>;
  listIssues: (
    query?: IssueQuery,
  ) => Promise<{ issues: Issue[]; total: number }>;
  getIssue: (id: number, withJournals?: boolean) => Promise<Issue>;
  listStatuses: () => Promise<IssueStatus[]>;
  createIssue: (
    fields: IssueChanges & { project_id: number | string; subject: string },
  ) => Promise<Issue>;
  updateIssue: (id: number, changes: IssueChanges) => Promise<void>;
};

export type TrackerLink = {
  userId: string;
  redmineUserId: number;
  redmineLogin: string;
  encryptedApiKey: string;
};

export type Subscription = {
  id: number;
  guildId: string;
  channelId: string;
  projectId: number;
  projectName: string;
  createdBy: string;
  checkpoint: Date;
};

export type TrackerRepository = {
  saveLink: (link: TrackerLink) => Promise<void>;
  link: (userId: string) => Promise<TrackerLink | undefined>;
  unlink: (userId: string) => Promise<boolean>;
  subscribe: (
    subscription: Omit<Subscription, 'id' | 'checkpoint'>,
  ) => Promise<boolean>;
  unsubscribe: (
    guildId: string,
    channelId: string,
    projectId: number,
  ) => Promise<boolean>;
  subscriptions: (afterId?: number, limit?: number) => Promise<Subscription[]>;
  setCheckpoint: (id: number, checkpoint: Date) => Promise<void>;
  claimNotification: (subscriptionId: number, key: string) => Promise<boolean>;
};
