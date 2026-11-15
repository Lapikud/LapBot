import { z } from 'zod';

const named = z.object({ id: z.number(), name: z.string() });

const userSchema = z.object({
  id: z.number(),
  login: z.string(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
});

const projectSchema = z.object({
  id: z.number(),
  name: z.string(),
  identifier: z.string(),
  description: z.string().nullish(),
});

const journalSchema = z.object({
  id: z.number(),
  user: named.optional(),
  notes: z.string().nullish(),
  private_notes: z.boolean().optional(),
  created_on: z.string(),
  details: z
    .array(
      z.object({
        property: z.string(),
        name: z.string(),
        old_value: z.string().nullish(),
        new_value: z.string().nullish(),
      }),
    )
    .default([]),
});

const issueSchema = z.object({
  id: z.number(),
  project: named,
  tracker: named,
  status: named.extend({ is_closed: z.boolean().optional() }),
  priority: named,
  author: named,
  assigned_to: named.optional(),
  subject: z.string(),
  description: z.string().nullish(),
  due_date: z.string().nullish(),
  done_ratio: z.number().optional(),
  is_private: z.boolean().optional(),
  created_on: z.string(),
  updated_on: z.string(),
  journals: z.array(journalSchema).optional(),
});

const statusSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_closed: z.boolean().optional(),
});

const projectsPage = z.object({
  projects: z.array(projectSchema),
  total_count: z.number().optional(),
});
const issuesPage = z.object({
  issues: z.array(issueSchema),
  total_count: z.number().optional(),
});

export type RedmineUser = z.infer<typeof userSchema>;
export type RedmineProject = z.infer<typeof projectSchema>;
export type RedmineIssue = z.infer<typeof issueSchema>;
export type RedmineJournal = z.infer<typeof journalSchema>;
export type RedmineStatus = z.infer<typeof statusSchema>;

export type RedmineErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'unavailable'
  | 'invalid_response';

export class RedmineError extends Error {
  override readonly name = 'RedmineError';
  constructor(
    readonly kind: RedmineErrorKind,
    message: string,
  ) {
    super(message);
  }
}

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

type Request = {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  query?: Record<string, string>;
};

const messages: Record<number, [RedmineErrorKind, string]> = {
  401: [
    'auth',
    'Redmine rejected the API key. Link your account again with `/redmine link`.',
  ],
  403: ['forbidden', 'Your Redmine account is not allowed to do that.'],
  404: ['not_found', 'Redmine could not find that (or you cannot see it).'],
};

const redmineTime = (date: Date) => `${date.toISOString().slice(0, 19)}Z`;

export class RedmineClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly options: { timeoutMs?: number; fetch?: typeof fetch } = {},
  ) {}

  private async request(path: string, request: Request = {}): Promise<unknown> {
    const url = new URL(
      path,
      this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`,
    );

    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const method = request.method ?? 'GET';

    try {
      return await this.send(url, method, request.body);
    } catch (error) {
      const retryable =
        method === 'GET' &&
        error instanceof RedmineError &&
        error.kind === 'unavailable';

      if (!retryable) {
        throw error;
      }

      return this.send(url, method, request.body);
    }
  }

  private async send(
    url: URL,
    method: string,
    body: unknown,
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method,
        headers: {
          'X-Redmine-API-Key': this.apiKey,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new RedmineError('unavailable', 'Redmine did not respond in time.');
    }

    if (response.status === 422) {
      const parsed = z
        .object({ errors: z.array(z.string()) })
        .safeParse(await response.json().catch(() => null));

      throw new RedmineError(
        'validation',
        parsed.success
          ? parsed.data.errors.join('; ')
          : 'Redmine rejected the request.',
      );
    }

    const known = messages[response.status];

    if (known) {
      throw new RedmineError(...known);
    }

    if (!response.ok) {
      throw new RedmineError(
        'unavailable',
        `Redmine is unavailable (HTTP ${response.status}).`,
      );
    }

    const text = await response.text();

    return text === '' ? null : JSON.parse(text);
  }

  private async get<T extends z.ZodType>(
    path: string,
    schema: T,
    query?: Record<string, string>,
  ): Promise<z.infer<T>> {
    const parsed = schema.safeParse(
      await this.request(path, query === undefined ? {} : { query }),
    );

    if (!parsed.success) {
      throw new RedmineError(
        'invalid_response',
        'Redmine sent a response I do not understand.',
      );
    }

    return parsed.data;
  }

  async currentUser(): Promise<RedmineUser> {
    const data = await this.get(
      'users/current.json',
      z.object({ user: userSchema }),
    );

    return data.user;
  }

  async listProjects(
    offset = 0,
    limit = 25,
  ): Promise<{ projects: RedmineProject[]; total: number }> {
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
  ): Promise<{ issues: RedmineIssue[]; total: number }> {
    const params: Record<string, string> = {
      status_id: query.status ?? 'open',
      sort: query.sort ?? 'updated_on:desc',
      offset: String(query.offset ?? 0),
      limit: String(Math.min(query.limit ?? 25, 100)),
    };

    if (query.projectId !== undefined) {
      params.project_id = String(query.projectId);
    }

    if (query.assignedToMe === true) {
      params.assigned_to_id = 'me';
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

  async getIssue(id: number, withJournals = false): Promise<RedmineIssue> {
    const query = withJournals ? { include: 'journals' } : undefined;
    const data = await this.get(
      `issues/${id}.json`,
      z.object({ issue: issueSchema }),
      query,
    );

    return data.issue;
  }

  async listStatuses(): Promise<RedmineStatus[]> {
    const data = await this.get(
      'issue_statuses.json',
      z.object({ issue_statuses: z.array(statusSchema) }),
    );

    return data.issue_statuses;
  }

  async createIssue(
    fields: IssueChanges & { project_id: number | string; subject: string },
  ): Promise<RedmineIssue> {
    const data = await this.request('issues.json', {
      method: 'POST',
      body: { issue: fields },
    });
    const parsed = z.object({ issue: issueSchema }).safeParse(data);

    if (!parsed.success) {
      throw new RedmineError(
        'invalid_response',
        'Redmine created the issue but sent an unexpected response.',
      );
    }

    return parsed.data.issue;
  }

  async updateIssue(id: number, changes: IssueChanges): Promise<void> {
    await this.request(`issues/${id}.json`, {
      method: 'PUT',
      body: { issue: changes },
    });
  }
}
