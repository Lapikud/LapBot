import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '~/core/ports';
import {
  createAnnouncementService,
  createAuthorizer,
  createEventService,
  createPermissionService,
  createPollService,
} from '~/core/services';
import {
  createAnnouncementRepository,
  createEventRepository,
  createGrantRepository,
  createPollRepository,
} from '~/infra/db';
import type { Permission, PermissionDefinition } from '~/domain';
import { createWebApp, localOperator, type WebApp } from '~/infra/web';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';

const teamId = '123456789012345678';

describe.skipIf(noDatabase)('web UI', () => {
  const guildId = snowflake();
  const { messenger } = fakeMessenger();
  const directory = fakeDirectory([role({ id: teamId, name: 'Team' })]);
  let app: WebApp;

  directory.channels.mockResolvedValue([
    { id: 'general', name: 'general', kind: 'text' },
  ]);

  beforeAll(async () => {
    const db = testDb();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const authz = createAuthorizer(createGrantRepository(db));
    const shared = {
      scheduler,
      messenger,
      directory,
      authz,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    };

    app = createWebApp({
      guildId,
      timezone: 'Europe/Tallinn',
      auth: localOperator(async () => actor({ guildId, administrator: true })),
      directory,
      log: silentLog,
      services: {
        announcements: createAnnouncementService({
          ...shared,
          announcements: createAnnouncementRepository(db),
          clock: { now: () => new Date() },
        }),
        events: createEventService({
          ...shared,
          events: createEventRepository(db),
          calendar: { upsert: async () => 'n', remove: async () => undefined },
        }),
        polls: createPollService({
          ...shared,
          polls: createPollRepository(db),
        }),
        permissions: createPermissionService({
          grants: createGrantRepository(db),
          directory,
          authz,
          log: silentLog,
          known: () =>
            new Map<Permission, PermissionDefinition>([
              [
                'event:create',
                { id: 'event:create', description: 'Create events' },
              ],
            ]),
        }),
      },
    });
  });

  const get = (path: string) => app.request(`http://localhost${path}`);

  const post = (
    path: string,
    fields: Record<string, string | string[]>,
    origin = 'http://localhost',
  ) => {
    const body = new URLSearchParams();

    for (const [name, value] of Object.entries(fields)) {
      for (const item of [value].flat()) {
        body.append(name, item);
      }
    }

    return app.request(`http://localhost${path}`, {
      method: 'POST',
      body,
      headers: { Origin: origin },
    });
  };

  it('renders the PSA composer with channels and mentionable roles', async () => {
    const response = await get('/psa');
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain('#general');
    expect(page).toContain('@Team');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
  });

  it('serves the stylesheet the pages link to', async () => {
    const response = await get('/style.css');

    expect(response.headers.get('content-type')).toContain('text/css');
    expect(await response.text()).toContain('.discord');
  });

  it('rejects forms posted from another site', async () => {
    const response = await post(
      '/psa',
      { channelId: 'general', content: 'x', action: 'publish' },
      'https://evil.example',
    );

    expect(response.status).toBe(403);
    expect(messenger.send).not.toHaveBeenCalled();
  });

  it('previews without posting, escaping user text', async () => {
    const response = await post('/psa', {
      channelId: 'general',
      title: '<b>Hi</b>',
      content: `Meeting <@&${teamId}> **now**`,
      role: teamId,
      action: 'preview',
    });
    const page = await response.text();

    expect(page).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(page).toMatch(/class="mention"\s*>@Team</);
    expect(messenger.send).not.toHaveBeenCalled();
  });

  it('publishes a PSA with the chosen role mentions', async () => {
    const response = await post('/psa', {
      channelId: 'general',
      title: 'Hackathon',
      content: 'Sign up today',
      role: teamId,
      action: 'publish',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('published');
    expect(messenger.send).toHaveBeenCalledWith(
      'general',
      expect.objectContaining({
        content: `<@&${teamId}>\n# Hackathon\nSign up today`,
        mentions: { everyone: false, roles: [teamId] },
      }),
    );
  });

  it('shows service errors as a message instead of failing', async () => {
    const response = await post('/psa', {
      channelId: 'general',
      content: ' ',
      action: 'draft',
    });

    expect(response.status).toBe(303);
    expect(
      decodeURIComponent(response.headers.get('location') ?? ''),
    ).toContain('error=');
  });

  it('creates polls', async () => {
    const poll = await post('/polls', {
      question: 'Lunch?',
      options: 'Pizza\nSushi',
      channelId: 'general',
    });

    expect(poll.status).toBe(303);
  });

  it('returns 404 for unknown pages', async () => {
    expect((await get('/nope')).status).toBe(404);
  });
});
