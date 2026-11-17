import { Hono } from 'hono';
import { afterEach, expect, it } from 'vitest';
import { createLogStore } from '~/integrations/logging/store';
import { logPages } from '~/integrations/web/logs';
import type { Env, WebDeps } from '~/integrations/web/context';
import { createWebApp } from '~/integrations/web/app';
import { setSignedCookie } from 'hono/cookie';
import { actor, fakeDirectory, allowAll, silentLog } from '../../fakes';

const archives: Array<ReturnType<typeof createLogStore>> = [];

function memoryLogs() {
  const logs = createLogStore(':memory:');

  archives.push(logs);

  return logs;
}

afterEach(() => {
  for (const logs of archives.splice(0)) {
    logs.close();
  }
});

function setup(administrator = true) {
  const logs = memoryLogs();
  const app = new Hono<Env>();

  logs.write(
    JSON.stringify({
      time: Date.now(),
      level: 30,
      msg: 'Ready',
      service: 'startup',
    }),
  );
  logs.write(
    JSON.stringify({
      time: Date.now(),
      level: 50,
      msg: '<script>alert(1)</script>',
      service: 'polls',
      err: { message: 'Discord unavailable' },
    }),
  );
  app.use(async (c, next) => {
    c.set('actor', actor({ administrator }));
    c.set('can', new Set(['permissions:manage'] as const));
    await next();
  });
  app.route('/logs', logPages('UTC', logs));

  return app;
}

it('renders escaped structured logs with refresh and level/text filters', async () => {
  const app = setup();
  const response = await app.request('/logs?level=error&q=discord');
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('refresh')).toBe('10');
  expect(html).toContain('href="/logs"');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('Discord unavailable');
  expect(html).not.toContain('>Ready<');
  expect(html).toContain('value="error" selected');
  expect(html).toContain('value="discord"');
});

it('allows pausing refresh without losing filters and handles empty results', async () => {
  const response = await setup().request('/logs?level=fatal&q=polls&live=0');
  const html = await response.text();

  expect(response.headers.get('refresh')).toBeNull();
  expect(html).toContain('Resume refresh');
  expect(html).toContain('No matching log entries.');
  expect(html).toContain('level=fatal');
  expect(html).toContain('q=polls');
});

it('denies non-administrators even if a dashboard permission is present', async () => {
  const response = await setup(false).request('/logs');

  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('Discord unavailable');
});

it('requires sign-in on the mounted dashboard route', async () => {
  const directory = fakeDirectory();
  const sessionSecret = 's'.repeat(32);
  const app = createWebApp({
    guildId: 'g',
    timezone: 'UTC',
    directory,
    authz: allowAll,
    log: silentLog,
    logs: memoryLogs(),
    signIn: {
      clientId: 'c',
      clientSecret: 's',
      publicUrl: 'http://localhost',
      sessionSecret,
    },
    services: {
      permissions: {
        catalogue: () => [
          { id: 'permissions:manage', description: 'Manage permissions' },
        ],
      },
    },
  } as unknown as WebDeps);
  const anonymous = await app.request('/logs');

  expect(anonymous.status).toBe(303);
  expect(anonymous.headers.get('location')).toBe('/login');

  const issuer = new Hono().get('/', async (c) => {
    await setSignedCookie(
      c,
      'session',
      JSON.stringify({ userId: 'u', expiresAt: Date.now() + 60_000 }),
      sessionSecret,
    );

    return c.text('');
  });
  const issued = await issuer.request('/');
  const headers = {
    cookie: issued.headers.get('set-cookie')?.split(';')[0] ?? '',
  };

  directory.member.mockResolvedValue(actor({ administrator: false }));
  expect((await app.request('/logs', { headers })).status).toBe(403);
  directory.member.mockResolvedValue(actor({ administrator: true }));
  expect((await app.request('/logs', { headers })).status).toBe(200);
});

it('preserves filters when browsing archived entries and pauses refresh on older pages', async () => {
  const logs = memoryLogs();

  for (let index = 0; index < 105; index++) {
    logs.write(
      JSON.stringify({
        time: Date.now(),
        level: 50,
        msg: `Archived ${index}`,
        service: 'polls',
      }),
    );
  }

  const app = new Hono<Env>();

  app.use(async (c, next) => {
    c.set('actor', actor({ administrator: true }));
    c.set('can', new Set(['permissions:manage'] as const));
    await next();
  });
  app.route('/logs', logPages('UTC', logs));
  const latest = await app.request('/logs?level=error&q=Archived');
  const html = await latest.text();

  expect(html).toContain('Older entries');
  expect(html).toContain('before=6');
  const older = await app.request('/logs?level=error&q=Archived&before=6');
  const olderHtml = await older.text();

  expect(older.headers.get('refresh')).toBeNull();
  expect(olderHtml).toContain('Archived 0');
  expect(olderHtml).not.toContain('Archived 104');
  expect(olderHtml).toContain('Latest entries');
  logs.close();
});
