import type { Permission } from '~/core/permission';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { describe, expect, it, vi } from 'vitest';
import { eventSuggestionRoutes } from '~/web/pages/post/event-suggestions/routes';
import type { Env, WebDeps } from '~/web/context';
import { actor } from './fakes';

function fixture(allowed: boolean) {
  const review = vi.fn(async () => {
    if (!allowed) {
      throw new Error('denied');
    }
  });
  const list = vi.fn(async () => {
    if (!allowed) {
      throw new Error('denied');
    }

    return [];
  });
  const app = new Hono<Env>();

  app.use(csrf());
  app.use(async (c, next) => {
    c.set('actor', actor());
    c.set(
      'can',
      new Set<Permission>(allowed ? ['event:suggestions:manage'] : []),
    );
    await next();
  });
  app.onError((_error, c) => c.text('denied', 403));
  app.route(
    '/post/event-suggestions',
    eventSuggestionRoutes({
      timezone: 'Europe/Tallinn',
      services: { eventSuggestions: { review, list } },
    } as unknown as WebDeps),
  );

  return { app, review, list };
}

describe('event suggestion routes', () => {
  it('renders the authorized inbox and denies unauthorized reads', async () => {
    expect(
      (await fixture(true).app.request('/post/event-suggestions')).status,
    ).toBe(200);
    expect(
      (await fixture(false).app.request('/post/event-suggestions')).status,
    ).toBe(403);
  });
  it('rejects cross-site form submissions before invoking review', async () => {
    const { app, review } = fixture(true);
    const response = await app.request(
      'https://lapbot.example/post/event-suggestions/1',
      {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'status=reviewed',
      },
    );

    expect(response.status).toBe(403);
    expect(review).not.toHaveBeenCalled();
  });
  it('checks authorization on direct same-origin review requests', async () => {
    const { app, review } = fixture(false);
    const response = await app.request(
      'https://lapbot.example/post/event-suggestions/1',
      {
        method: 'POST',
        headers: {
          origin: 'https://lapbot.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'status=dismissed',
      },
    );

    expect(response.status).toBe(403);
    expect(review).toHaveBeenCalledWith(actor(), 1, 'dismissed');
  });
});
