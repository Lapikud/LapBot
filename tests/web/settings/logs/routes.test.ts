import { Hono } from 'hono';
import { setSignedCookie } from 'hono/cookie';
import { afterEach, expect, it } from 'vitest';
import { createLogStore } from '~/integrations/logging/store';
import { createWebApp } from '~/web/app';
import type { Env, WebDeps } from '~/web/context';
import { logRoutes } from '~/web/pages/settings/logs/routes';
import { actor, allowAll, fakeDirectory, silentLog } from '../../../fakes';

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
  app.route('/settings/logs', logRoutes('UTC', logs));

  return app;
}

it('denies non-administrators even if a dashboard permission is present', async () => {
  const response = await setup(false).request('/settings/logs');

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
  const anonymous = await app.request('/settings/logs');

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
  expect((await app.request('/settings/logs', { headers })).status).toBe(403);
  directory.member.mockResolvedValue(actor({ administrator: true }));
  expect((await app.request('/settings/logs', { headers })).status).toBe(200);
});
