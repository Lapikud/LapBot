import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Permission } from '~/core/permission';
import { Layout } from '~/web/layout';

async function page(can: readonly Permission[], path = '/') {
  const app = new Hono().get('/', (c) =>
    c.html(Layout({ title: 'Overview', path, can: new Set(can) })),
  );

  return (await app.request('/')).text();
}

describe('primary navigation', () => {
  it('links sections directly to their first permitted page', async () => {
    const html = await page(['permissions:manage']);

    expect(html).toContain('href="/events">Events</a>');
    expect(html).toContain('href="/settings/permissions">Settings</a>');
    expect(html).not.toContain('href="/announcements"');
    expect(html).not.toContain('href="/settings/roles"');
  });
});
