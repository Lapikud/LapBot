import { describe, expect, it, vi } from 'vitest';
import { IntegrationError } from '~/domain';
import { RedmineClient } from '~/infra/redmine';

const issue = {
  id: 7,
  project: { id: 1, name: 'Web' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 1, name: 'New' },
  priority: { id: 2, name: 'Normal' },
  author: { id: 3, name: 'Mari' },
  subject: 'Fix login',
  created_on: '2026-11-01T10:00:00Z',
  updated_on: '2026-11-02T10:00:00Z',
};

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

function client(...responses: Array<Response | Error>) {
  const fetch = vi.fn<typeof globalThis.fetch>();

  for (const response of responses) {
    if (response instanceof Error) {
      fetch.mockRejectedValueOnce(response);
    } else {
      fetch.mockResolvedValueOnce(response);
    }
  }

  return {
    fetch,
    redmine: new RedmineClient('https://redmine.example', 'secret', { fetch }),
  };
}

const kind = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof IntegrationError ? error.kind : 'other';
  }

  return 'none';
};

describe('RedmineClient', () => {
  it('sends the API key and builds filtered issue queries', async () => {
    const { fetch, redmine } = client(
      json(200, { issues: [issue], total_count: 1 }),
    );
    const result = await redmine.listIssues({
      projectId: 'web',
      assignedToMe: true,
      updatedSince: new Date('2026-11-01T10:00:00.123Z'),
    });

    expect(result.issues[0]?.subject).toBe('Fix login');
    const [input, init] = fetch.mock.calls[0] ?? [];
    const url = input instanceof URL ? input.href : '';

    expect(url).toContain('project_id=web');
    expect(url).toContain('assigned_to_id=me');
    expect(decodeURIComponent(url)).toContain(
      'updated_on=>=2026-11-01T10:00:00Z',
    );
    expect(new Headers(init?.headers).get('X-Redmine-API-Key')).toBe('secret');
  });

  it('rejects responses that do not match the expected shape', async () => {
    const { redmine } = client(json(200, { issue: { id: 'seven' } }));

    expect(await kind(redmine.getIssue(7))).toBe('invalid_response');
  });

  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not_found'],
  ])('maps HTTP %i to %s', async (status, expected) => {
    const { redmine } = client(json(status, {}));

    expect(await kind(redmine.currentUser())).toBe(expected);
  });

  it('reports validation errors from Redmine', async () => {
    const { redmine } = client(
      json(422, { errors: ['Subject cannot be blank'] }),
    );

    await expect(
      redmine.createIssue({ project_id: 1, subject: '' }),
    ).rejects.toThrow('Subject cannot be blank');
  });

  it('retries reads once on timeouts but never retries writes', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    const read = client(timeout, json(200, { user: { id: 1, login: 'mari' } }));

    expect((await read.redmine.currentUser()).login).toBe('mari');
    expect(read.fetch).toHaveBeenCalledTimes(2);

    const write = client(timeout, json(204, undefined));

    expect(await kind(write.redmine.updateIssue(7, { notes: 'hi' }))).toBe(
      'unavailable',
    );
    expect(write.fetch).toHaveBeenCalledOnce();
  });

  it('treats server errors as unavailable', async () => {
    const { redmine } = client(json(502, {}), json(503, {}));

    expect(await kind(redmine.listProjects())).toBe('unavailable');
  });
});
