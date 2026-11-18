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

    expect(html).toContain('href="/post/events">Post</a>');
    expect(html).toContain('href="/forms/birthdays">Forms</a>');
    expect(html).toContain('href="/settings/permissions">Settings</a>');
    expect(html).not.toContain('href="/post/announcements"');
  });

  it('links publishers to announcements while retaining the active parent section', async () => {
    const html = await page(['announcement:create'], '/post/polls');

    expect(html).toContain(
      'href="/post/announcements" aria-current="page">Post</a>',
    );
    expect(html).toContain('href="/post/polls" aria-current="page">Polls</a>');
    expect(html).not.toContain('>Settings</a>');
  });
});
