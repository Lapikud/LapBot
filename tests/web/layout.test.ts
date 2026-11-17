import { expect, it } from 'vitest';
import { jsx } from 'hono/jsx/jsx-runtime';
import { Layout } from '~/web/layout';
import type { Permission } from '~/core/permission';

const can = new Set<Permission>(['announcement:create', 'permissions:manage']);

it('groups navigation into five sections and keeps the current post type visible', async () => {
  const html = await jsx(Layout, {
    title: 'Events',
    path: '/post/events',
    can,
  }).toString();
  const primary = /<nav aria-label="Primary">(.*?)<\/nav>/s.exec(html)?.[1];

  expect(primary?.match(/<a /g)).toHaveLength(5);
  for (const label of ['Overview', 'Post', 'Forms', 'Roles', 'Settings']) {
    expect(primary).toContain(`>${label}</a>`);
  }

  expect(html).toContain('href="/post" aria-current="page"');
  expect(html).toContain('aria-label="Post pages"');
  expect(html).toContain('href="/post/events" aria-current="page"');
  expect(html).toContain('<h1>Post</h1>');
  expect(html.match(/<h1>/g)).toHaveLength(1);
});

it('hides restricted sections and post types while keeping public sections available', async () => {
  const html = await jsx(Layout, {
    title: 'Events',
    path: '/post/events',
    can: new Set<Permission>(),
  }).toString();

  expect(html).toContain('href="/forms"');
  expect(html).toContain('href="/post/events"');
  expect(html).not.toContain('href="/post/announcements"');
  expect(html).not.toContain('href="/settings"');
  expect(html).not.toContain('href="/roles"');
});

it('keeps composer headings specific without adding a second section heading', async () => {
  const html = await jsx(Layout, {
    title: 'New event',
    path: '/post/events',
    can,
  }).toString();

  expect(html).toContain('<h1>New event</h1>');
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain('href="/post" aria-current="page"');
});
