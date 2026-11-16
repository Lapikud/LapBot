import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '~/core/ports';
import {
  createAnnouncementService,
  createAuthorizer,
  createBirthdayService,
  createMovieService,
  createEventService,
  createPermissionService,
  createPollService,
} from '~/core/services';
import {
  createAnnouncementRepository,
  createBirthdayRepository,
  createMovieRepository,
  createEventRepository,
  createGrantRepository,
  createPollRepository,
} from '~/infra/db';
import type { Permission, PermissionDefinition } from '~/domain';
import { createWebApp, type WebApp } from '~/infra/web';
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
      services: {
        announcements: createAnnouncementService({
          ...shared,
          announcements: createAnnouncementRepository(db),
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
    const response = await get('/app.css');

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

  it('saves birthday settings and lists upcoming birthdays', async () => {
    const saved = await post('/birthdays', {
      channelId: 'general',
      roleId: '',
      hour: '8',
      action: 'save',
    });
    const page = await (await get('/birthdays')).text();

    expect(saved.status).toBe(303);
    expect(page).toContain('Announced in #general at 8:00');
  });

  it('creates an event and edits it', async () => {
    const created = await post('/events', {
      title: 'Board games',
      start: '2030-05-10 18:00',
      channelId: 'general',
      icons: '1',
    });
    const notice = new URL(
      created.headers.get('location') ?? '',
      'http://localhost',
    ).searchParams.get('notice');
    const id = /Event #(\d+)/.exec(notice ?? '')?.[1];
    const form = await (await get(`/events/${id}`)).text();
    const edited = await post(`/events/${id}`, {
      title: 'Board games night',
      start: '2030-05-10 18:00',
      location: 'Room 101',
    });

    expect(form).toContain('value="2030-05-10 18:00"');
    expect(edited.status).toBe(303);
    expect(await (await get('/events')).text()).toContain('Board games night');
  });

  it('posts the birthday sign-up message with its button', async () => {
    const response = await post('/birthdays/signup', { channelId: 'general' });

    expect(response.status).toBe(303);
    expect(messenger.send).toHaveBeenCalledWith(
      'general',
      expect.objectContaining({
        controls: [[expect.objectContaining({ id: 'birthdays:add' })]],
      }),
    );
  });

  it('suggests movies with links and lists them', async () => {
    const added = await post('/movies', {
      title: 'Paprika',
      year: '2006',
      links: 'https://letterboxd.com/film/paprika-2006/',
    });
    const page = await (await get('/movies')).text();

    expect(added.status).toBe(303);
    expect(page).toContain('Paprika (2006)');
    expect(page).toContain('letterboxd.com');
  });

  it('keeps members without dashboard access out', async () => {
    directory.member.mockResolvedValueOnce(
      actor({ guildId, userId: '42', administrator: false }),
    );

    expect((await get('/')).status).toBe(403);
  });

  it('sets the permissions of a role from the checkboxes', async () => {
    const page = await (await get(`/permissions?role=${teamId}`)).text();
    const notice = async (fields: Record<string, string | string[]>) => {
      const response = await post(`/permissions/${teamId}`, fields);

      return new URL(
        response.headers.get('location') ?? '',
        'http://localhost',
      ).searchParams.get('notice');
    };

    expect(page).toContain('value="event:create"');
    expect(await notice({ permission: 'event:create' })).toBe(
      'Saved: 1 added, 0 removed.',
    );
    expect(await notice({ permission: 'event:create' })).toBe(
      'Nothing changed.',
    );
    expect(await notice({})).toBe('Saved: 0 added, 1 removed.');
  });

  it('shows members only the parts they may use', async () => {
    await post(`/permissions/${teamId}`, { permission: 'web:access' });
    directory.member.mockResolvedValueOnce(
      actor({ guildId, userId: '42', roleIds: [teamId] }),
    );

    const page = await (await get('/events')).text();

    expect(page).toContain('href="/movies"');
    expect(page).not.toContain('href="/permissions"');
    expect(page).not.toContain('href="/psa"');
    expect(page).not.toContain('New event');

    await post(`/permissions/${teamId}`, {});
  });

  it('returns 404 for unknown pages', async () => {
    expect((await get('/nope')).status).toBe(404);
  });
});
