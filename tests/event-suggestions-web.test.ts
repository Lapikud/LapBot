import type { Permission } from '~/core/permission';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { eventSuggestionRoutes } from '~/web/pages/events/suggestions/routes';
import type { Env, WebDeps } from '~/web/context';
import { actor } from './fakes';

function fixture() {
  const review = vi.fn(async () => undefined);
  const app = new Hono<Env>();

  app.use(async (c, next) => {
    c.set('actor', actor());
    c.set('can', new Set<Permission>());
    await next();
  });
  app.route(
    '/events/suggestions',
    eventSuggestionRoutes({
      timezone: 'Europe/Tallinn',
      services: { eventSuggestions: { review, list: async () => [] } },
    } as unknown as WebDeps),
  );

  return { app, review };
}

describe('event suggestion routes', () => {
  it('passes valid review data to the service', async () => {
    const { app, review } = fixture();
    const response = await app.request(
      'https://lapbot.example/events/suggestions/1',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'status=dismissed',
      },
    );

    expect(response.status).toBe(303);
    expect(review).toHaveBeenCalledWith(actor(), 1, 'dismissed');
  });
});
