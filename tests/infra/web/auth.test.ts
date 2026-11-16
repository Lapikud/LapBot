import { Hono } from 'hono';
import { setSignedCookie } from 'hono/cookie';
import { expect, it } from 'vitest';
import { signedInUser, type SignIn } from '~/infra/web/auth';
import type { Env } from '~/infra/web/context';

const signIn = { sessionSecret: 'test-secret' } as SignIn;

it('rejects expired, malformed and legacy sessions while accepting a fresh session', async () => {
  const app = new Hono<Env>();

  app.get('/cookie', async (c) => {
    await setSignedCookie(
      c,
      'session',
      c.req.query('value') ?? '',
      signIn.sessionSecret,
    );

    return c.text('');
  });
  app.get('/', async (c) =>
    c.text((await signedInUser(c, signIn)) ?? 'anonymous'),
  );

  for (const [value, expected] of [
    [JSON.stringify({ userId: '123', expiresAt: Date.now() + 60_000 }), '123'],
    [JSON.stringify({ userId: '123', expiresAt: Date.now() - 1 }), 'anonymous'],
    [JSON.stringify({ userId: '123' }), 'anonymous'],
    ['123', 'anonymous'],
    ['broken', 'anonymous'],
  ]) {
    const issued = await app.request(
      `/cookie?value=${encodeURIComponent(value ?? '')}`,
    );
    const cookie = issued.headers.get('set-cookie')?.split(';')[0] ?? '';

    expect(await (await app.request('/', { headers: { cookie } })).text()).toBe(
      expected,
    );
  }
});
