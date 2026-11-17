import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { createLogBuffer } from '~/infra/logging';
import { logPages } from '~/infra/web/logs';
import type { Env, WebDeps } from '~/infra/web/context';
import { createWebApp } from '~/infra/web';
import { setSignedCookie } from 'hono/cookie';
import { actor, fakeDirectory, allowAll, silentLog } from '../../fakes';

function setup(administrator = true) {
  const logs = createLogBuffer();
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
