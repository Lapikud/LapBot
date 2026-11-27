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
  it('groups permitted destinations without crowding the header', async () => {
    const html = await page(['permissions:manage', 'form:manage'], '/events');
    const primary = /<nav[^>]*aria-label="Primary">([\s\S]*?)<\/nav>/.exec(
      html,
    )?.[1];

    expect(primary).toMatch(/href="\/events"[^>]*>Community<\/a>/);
    expect(primary).toContain('href="/forms">Forms</a>');
    expect(primary).toContain('href="/birthdays">Personal</a>');
    expect(primary).toContain('href="/settings/permissions">Settings</a>');
    expect(primary).not.toContain('>Reminders</a>');
    expect(primary).not.toContain('>Polls</a>');
    expect(html).toContain('aria-label="Community pages"');
  });

  it('marks the active group and destination on nested event pages', async () => {
    const html = await page(
      ['event:suggestions:manage'],
      '/events/suggestions',
    );

    expect(html).toContain('href="/events" aria-current="true">Community</a>');
    expect(html).toContain(
      'href="/events/suggestions" aria-current="page">Suggestions</a>',
    );
  });
});
