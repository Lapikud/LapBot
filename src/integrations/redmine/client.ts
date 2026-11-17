import { z } from 'zod';
import type { IssueTracker } from './contract';
import {
  IntegrationError,
  type IntegrationErrorKind,
  type Issue,
  type IssueQuery,
  type IssueStatus,
  type TrackerProject,
} from './model';

const named = z.object({ id: z.number(), name: z.string() });

const projectSchema = z.object({
  id: z.number(),
  name: z.string(),
  identifier: z.string(),
  description: z.string().nullable().exactOptional(),
});

const journalSchema = z.object({
  id: z.number(),
  user: named.exactOptional(),
  notes: z.string().nullable().exactOptional(),
  private_notes: z.boolean().exactOptional(),
  created_on: z.string(),
  details: z
    .array(
      z.object({
        property: z.string(),
        name: z.string(),
        old_value: z.string().nullable().exactOptional(),
        new_value: z.string().nullable().exactOptional(),
      }),
    )
    .default([]),
});

const issueSchema = z.object({
  id: z.number(),
  project: named,
  tracker: named,
  status: named.extend({ is_closed: z.boolean().exactOptional() }),
  priority: named,
  author: named,
  assigned_to: named.exactOptional(),
  subject: z.string(),
  description: z.string().nullable().exactOptional(),
  due_date: z.string().nullable().exactOptional(),
  done_ratio: z.number().exactOptional(),
  is_private: z.boolean().exactOptional(),
  created_on: z.string(),
  updated_on: z.string(),
  journals: z.array(journalSchema).exactOptional(),
});

const statusSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_closed: z.boolean().exactOptional(),
});

const projectsPage = z.object({
  projects: z.array(projectSchema),
  total_count: z.number().exactOptional(),
});
const issuesPage = z.object({
  issues: z.array(issueSchema),
  total_count: z.number().exactOptional(),
});

const messages: Record<number, [IntegrationErrorKind, string]> = {
  401: ['auth', 'Redmine rejected REDMINE_API_KEY.'],
  403: ['forbidden', 'The Redmine service account is not allowed to do that.'],
  404: ['not_found', 'Redmine could not find that (or you cannot see it).'],
};

const redmineTime = (date: Date) => `${date.toISOString().slice(0, 19)}Z`;

export class RedmineClient implements IssueTracker {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly options: { timeoutMs?: number; fetch?: typeof fetch } = {},
  ) {}

  private async request(
    path: string,
    query: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(
      path,
      this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`,
    );

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    try {
      return await this.send(url);
    } catch (error) {
      if (
        !(error instanceof IntegrationError) ||
        error.kind !== 'unavailable'
      ) {
        throw error;
      }

      return this.send(url);
    }
  }

  private async send(url: URL): Promise<unknown> {
    let response: Response;

    try {
      response = await (this.options.fetch ?? fetch)(url, {
        headers: {
          'X-Redmine-API-Key': this.apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new IntegrationError(
        'unavailable',
        'Redmine did not respond in time.',
      );
    }

    const known = messages[response.status];

    if (known) {
      throw new IntegrationError(...known);
    }

    if (!response.ok) {
      throw new IntegrationError(
        'unavailable',
        `Redmine is unavailable (HTTP ${response.status}).`,
      );
    }

    return response.json().catch(() => null);
  }

  private async get<T extends z.ZodType>(
    path: string,
    schema: T,
    query?: Record<string, string>,
  ): Promise<z.infer<T>> {
    const parsed = schema.safeParse(await this.request(path, query));

    if (!parsed.success) {
      throw new IntegrationError(
        'invalid_response',
        'Redmine sent a response I do not understand.',
      );
    }

    return parsed.data;
  }

  async listProjects(
    offset = 0,
    limit = 25,
  ): Promise<{ projects: TrackerProject[]; total: number }> {
    const data = await this.get('projects.json', projectsPage, {
      offset: String(offset),
      limit: String(Math.min(limit, 100)),
    });

    return {
      projects: data.projects,
      total: data.total_count ?? data.projects.length,
    };
  }

  async listIssues(
    query: IssueQuery = {},
  ): Promise<{ issues: Issue[]; total: number }> {
    const params: Record<string, string> = {
      status_id: query.status ?? 'open',
      sort: query.sort ?? 'updated_on:desc',
      offset: String(query.offset ?? 0),
      limit: String(Math.min(query.limit ?? 25, 100)),
    };

    if (query.projectId !== undefined) {
      params.project_id = String(query.projectId);
    }

    if (query.updatedSince) {
      params.updated_on = `>=${redmineTime(query.updatedSince)}`;
    }

    if (query.dueDate !== undefined) {
      params.due_date = query.dueDate;
    }

    const data = await this.get('issues.json', issuesPage, params);

    return {
      issues: data.issues,
      total: data.total_count ?? data.issues.length,
    };
  }

  async getIssue(id: number, withJournals = false): Promise<Issue> {
    const query = withJournals ? { include: 'journals' } : undefined;
    const data = await this.get(
      `issues/${id}.json`,
      z.object({ issue: issueSchema }),
      query,
    );

    return data.issue;
  }

  async listStatuses(): Promise<IssueStatus[]> {
    const data = await this.get(
      'issue_statuses.json',
      z.object({ issue_statuses: z.array(statusSchema) }),
    );

    return data.issue_statuses;
  }
}
