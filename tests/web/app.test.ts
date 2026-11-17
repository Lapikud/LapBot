import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Permission, PermissionDefinition } from '~/core/permission';
import type { Scheduler } from '~/core/ports/scheduler';
import { createAnnouncementRepository } from '~/features/announcements/repository';
import { createAnnouncementService } from '~/features/announcements/service';
import { createBirthdayRepository } from '~/features/birthdays/repository';
import { createBirthdayService } from '~/features/birthdays/service';
import { createEventRepository } from '~/features/events/repository';
import { createEventService } from '~/features/events/service';
import { createMovieRepository } from '~/features/movies/repository';
import { createMovieService } from '~/features/movies/service';
import { createGrantRepository } from '~/features/permissions/repository';
import {
  createAuthorizer,
  createPermissionService,
} from '~/features/permissions/service';
import { createPollRepository } from '~/features/polls/repository';
import { createPollService } from '~/features/polls/service';
import { createRolePanelRepository } from '~/features/roles/repository';
import { createRoleService } from '~/features/roles/service';
import { createLogStore } from '~/integrations/logging/store';
import { createWebApp, type WebApp } from '~/web/app';
import { noDatabase, snowflake, testDb } from '../db';
import { actor, fakeDirectory, fakeMessenger, role, silentLog } from '../fakes';

const teamId = '123456789012345678';

describe.skipIf(noDatabase)('web UI', () => {
  const guildId = snowflake();
  const { messenger } = fakeMessenger();
  const directory = fakeDirectory([role({ id: teamId, name: 'Team' })]);
  let app: WebApp;

  let cookie = '';

  directory.channels.mockResolvedValue([
    { id: 'general', name: 'general', kind: 'text' },
  ]);
  directory.member.mockImplementation(async (_guild, userId) =>
    userId === '42'
      ? actor({ guildId, userId, administrator: true })
      : undefined,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      input.includes('/oauth2/token')
        ? Response.json({
            access_token: 't',
            expires_in: 60,
            scope: 'identify',
          })
        : Response.json({ user: { id: '42' } }),
    ),
  );

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const cookiesOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');

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

    const events = createEventService({
      ...shared,
      events: createEventRepository(db),
      calendar: { upsert: async () => 'n', remove: async () => undefined },
    });
    const polls = createPollService({
      ...shared,
      polls: createPollRepository(db),
    });

    app = createWebApp({
      guildId,
      authz,
      timezone: 'Europe/Tallinn',
      signIn: {
        clientId: 'client',
        clientSecret: 'secret',
        publicUrl: 'http://localhost',
        sessionSecret: 'x'.repeat(32),
      },
      directory,
      log: silentLog,
      logs: createLogStore(':memory:'),
      services: {
        roles: createRoleService({
          panels: createRolePanelRepository(db),
          directory,
          messenger,
          log: silentLog,
        }),
        announcements: createAnnouncementService({
          ...shared,
          posts: createAnnouncementRepository(db),
          clock: { now: () => new Date() },
        }),
        events,
        polls,
        movies: createMovieService({
          movies: createMovieRepository(db),
          catalog: undefined,
          polls,
          events,
          authz,
          timezone: 'Europe/Tallinn',
        }),
        birthdays: createBirthdayService({
          ...shared,
          birthdays: createBirthdayRepository(db),
        }),
        permissions: createPermissionService({
          grants: createGrantRepository(db),
          directory,
          authz,
          log: silentLog,
          known: () =>
            new Map<Permission, PermissionDefinition>([
              [
                'permissions:manage',
                { id: 'permissions:manage', description: 'Manage permissions' },
              ],
              [
                'event:create',
                { id: 'event:create', description: 'Create events' },
              ],
              [
                'web:access',
                { id: 'web:access', description: 'Open the dashboard' },
              ],
              [
                'announcement:create',
                { id: 'announcement:create', description: 'Write PSAs' },
              ],
              [
                'announcement:publish',
                { id: 'announcement:publish', description: 'Publish PSAs' },
              ],
            ]),
        }),
      },
    });
  });

  const get = (path: string) =>
    app.request(`http://localhost${path}`, { headers: { Cookie: cookie } });

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
      headers: { Origin: origin, Cookie: cookie },
    });
  };

  it('sends visitors to Discord and signs members in', async () => {
    expect((await get('/')).headers.get('location')).toBe('/login');

    const start = await get('/login');
    const authorize = new URL(start.headers.get('location') ?? '');
    const state = authorize.searchParams.get('state') ?? '';
    const forged = await app.request(
      'http://localhost/login?code=c&state=forged',
      { headers: { Cookie: cookiesOf(start) } },
    );
    const done = await app.request(
      `http://localhost/login?code=c&state=${state}`,
      { headers: { Cookie: cookiesOf(start) } },
    );

    expect(authorize.host).toBe('discord.com');
    expect(forged.status).toBe(401);
    expect(done.headers.get('location')).toBe('/');

    cookie = cookiesOf(done);
    expect((await get('/')).status).toBe(200);
  });

  it('rejects forms posted from another site', async () => {
    const response = await post(
      '/post/announcements',
      { channelId: 'general', content: 'x', action: 'publish' },
      'https://evil.example',
    );

    expect(response.status).toBe(403);
    expect(messenger.send).not.toHaveBeenCalled();
  });

  it('previews without posting, escaping user text', async () => {
    const response = await post('/post/announcements', {
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

  it('keeps members without dashboard access out', async () => {
    directory.member.mockResolvedValueOnce(
      actor({ guildId, userId: '42', administrator: false }),
    );

    expect((await get('/')).status).toBe(403);
  });
});
