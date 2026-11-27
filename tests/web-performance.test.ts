import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';
import type { ChannelInfo } from '~/core/ports/directory';
import { createWebApp } from '~/web/app';
import type { WebDeps } from '~/web/context';
import { actor, allowAll, fakeDirectory, role, silentLog } from './fakes';

function fixture() {
  const directory = fakeDirectory([role()]);
  const authz = { ...allowAll, granted: vi.fn(allowAll.granted) };
  const sessionSecret = 's'.repeat(32);

  directory.member.mockImplementation(async (_guild, userId) =>
    actor({ userId, administrator: true }),
  );
  directory.channels.mockResolvedValue([
    { id: 'public', name: 'Public channel', kind: 'text' },
    { id: 'private', name: 'Private channel', kind: 'text' },
  ]);
  const app = createWebApp({
    guildId: 'g',
    timezone: 'UTC',
    directory,
    authz,
    log: silentLog,
    signIn: {
      clientId: 'c',
      clientSecret: 's',
      publicUrl: 'http://localhost',
      sessionSecret,
    },
    logs: {
      page: () => ({
        entries: [],
        total: 0,
        page: 1,
        pages: 1,
        hasMore: false,
      }),
      close: () => undefined,
      write: () => undefined,
    },
    services: {
      permissions: {
        catalogue: () => [{ id: 'event:create', description: 'Create events' }],
      },
      announcements: { list: async () => [] },
      polls: { open: async () => [] },
      events: {
        upcoming: async () => [],
        calendarEnabled: false,
        create: async () => ({ id: 1 }),
      },
    },
  } as unknown as WebDeps);
  const issuer = new Hono().get('/:user', async (c) => {
    setCookie(
      c,
      'session',
      await sign(
        { sub: c.req.param('user'), exp: Math.floor(Date.now() / 1000) + 60 },
        sessionSecret,
      ),
    );

    return c.text('');
  });
  const request = async (path: string, user = 'u', init: RequestInit = {}) => {
    const issued = await issuer.request(`/${user}`);
    const headers = new Headers(init.headers);

    if (init.method === 'POST') {
      headers.set('origin', 'http://localhost');
    }

    headers.set(
      'cookie',
      issued.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    );

    return app.request(path, { ...init, headers });
  };

  return { directory, authz, request };
}

afterEach(() => vi.restoreAllMocks());

describe('dashboard Discord requests', () => {
  it('redirects old dashboard addresses', async () => {
    const { request } = fixture();

    expect(
      (await request('/post/events/new?x=1')).headers.get('location'),
    ).toBe('/events/new?x=1');
    expect((await request('/roles')).headers.get('location')).toBe(
      '/settings/roles',
    );
  });

  it('skips metadata on overview, logs, section redirects and event submissions', async () => {
    const { directory, authz, request } = fixture();

    expect((await request('/')).status).toBe(200);
    expect((await request('/settings/logs')).status).toBe(200);
    const section = await request('/settings?notice=hello');

    expect(section.status).toBe(303);
    expect(section.headers.get('location')).toBe(
      '/settings/roles?notice=hello',
    );
    expect(
      (
        await request('/events', 'u', {
          method: 'POST',
          body: new URLSearchParams({
            title: 'Event',
            start: '1h',
            channelId: 'public',
          }),
        })
      ).status,
    ).toBe(303);
    expect(directory.channels).not.toHaveBeenCalled();
    expect(directory.roles).not.toHaveBeenCalled();
    expect(directory.member).toHaveBeenCalledTimes(4);
    expect(authz.granted).toHaveBeenCalledTimes(4);
  });

  it('shares metadata for 30 seconds while rechecking membership and permissions', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { directory, authz, request } = fixture();

    expect((await request('/events')).status).toBe(200);
    expect(directory.members).not.toHaveBeenCalled();
    expect((await request('/events/new')).status).toBe(200);
    clock.mockReturnValue(now + 29_999);
    expect((await request('/events/new')).status).toBe(200);
    expect(directory.channels).toHaveBeenCalledTimes(1);
    expect(directory.roles).toHaveBeenCalledTimes(1);
    expect(directory.members).toHaveBeenCalledTimes(1);
    expect(directory.member).toHaveBeenCalledTimes(3);
    expect(authz.granted).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(now + 30_000);
    expect((await request('/events/new')).status).toBe(200);
    expect(directory.channels).toHaveBeenCalledTimes(2);
    expect(directory.roles).toHaveBeenCalledTimes(2);
    expect(directory.members).toHaveBeenCalledTimes(2);
  });

  it('filters cached channels separately for each user and each request', async () => {
    const { directory, request } = fixture();

    directory.canView.mockImplementation(async (member, id) =>
      member.userId === 'one' ? id === 'public' : id === 'private',
    );
    const first = await (await request('/events/new', 'one')).text();
    const second = await (await request('/events/new', 'two')).text();

    expect(first).toContain('Public channel');
    expect(first).not.toContain('Private channel');
    expect(second).toContain('Private channel');
    expect(second).not.toContain('Public channel');
    directory.canView.mockResolvedValue(false);
    const revoked = await (await request('/events/new', 'one')).text();

    expect(revoked).not.toContain('Public channel');
    expect(directory.channels).toHaveBeenCalledTimes(1);
    expect(directory.roles).toHaveBeenCalledTimes(1);
  });

  it('denies revoked access and departed members even with warm metadata', async () => {
    const { directory, authz, request } = fixture();

    expect((await request('/events/new')).status).toBe(200);
    directory.member.mockResolvedValue(actor());
    authz.granted.mockResolvedValue(new Set());
    expect((await request('/events/new')).status).toBe(403);
    directory.member.mockResolvedValue(undefined);
    expect((await request('/events/new')).status).toBe(403);
    expect(directory.channels).toHaveBeenCalledTimes(1);
    expect(directory.roles).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight fetch even if Discord takes longer than the cache lifetime', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { directory, authz, request } = fixture();
    const pending = Promise.withResolvers<ChannelInfo[]>();
    const started = Promise.withResolvers<undefined>();

    directory.channels.mockImplementationOnce(() => {
      started.resolve(undefined);

      return pending.promise;
    });
    const first = request('/events/new');

    await started.promise;
    clock.mockReturnValue(now + 31_000);
    const second = request('/events/new');

    await vi.waitFor(() => expect(authz.granted).toHaveBeenCalledTimes(2));
    pending.resolve([]);
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(directory.channels).toHaveBeenCalledTimes(1);
    expect(directory.roles).toHaveBeenCalledTimes(1);
  });

  it('does not retain failed metadata fetches', async () => {
    const { directory, request } = fixture();

    directory.channels.mockRejectedValueOnce(new Error('Discord unavailable'));
    expect((await request('/events/new')).status).toBe(500);
    expect((await request('/events/new')).status).toBe(200);
    expect(directory.channels).toHaveBeenCalledTimes(2);
  });
});
