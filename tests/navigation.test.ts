import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { applicationAdmin, type Permission } from '~/core/permission';
import { HelpPage } from '~/web/pages/help/index';
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

  it('marks the section and the deepest matching page as current', async () => {
    const html = await page(['announcement:post'], '/events/movies/new');

    expect(html).toContain('href="/announcements">Announcements</a>');
    expect(html).toContain(
      'href="/events" aria-current="page">Events</a></li><li><a href="/polls"',
    );
    expect(html).toContain(
      'href="/events/movies" aria-current="page">Movies</a>',
    );
    expect(html).not.toContain('>Suggestions</a>');
    expect(html).not.toContain('>Settings</a>');
  });
});

describe('help page', () => {
  const help = async (can: readonly Permission[]) => {
    const app = new Hono().get('/', (c) =>
      c.html(HelpPage({ can: new Set(can) })),
    );

    return (await app.request('/')).text();
  };

  it('lists only what the viewer may use', async () => {
    const member = await help(['web:access']);
    const admin = await help([
      'web:access',
      applicationAdmin,
      'announcement:post',
    ]);

    expect(member).toContain('<h3>Polls</h3>');
    expect(member).not.toContain('<h3>Role panels</h3>');
    expect(member).not.toContain('<h3>Announcements</h3>');
    expect(admin).toContain('<h3>Role panels</h3>');
    expect(admin).toContain('<h3>Announcements</h3>');
  });
});
