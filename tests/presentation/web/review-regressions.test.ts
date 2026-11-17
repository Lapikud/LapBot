import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { type WebDeps, type Env, serverOf } from '~/presentation/web/context';
import { visibleRecords } from '~/core/helpers/visibility';
import { eventPages } from '~/presentation/web/pages/events';
import { pollPages } from '~/presentation/web/pages/polls';
import { psaPages } from '~/presentation/web/pages/announcements';
import { birthdayPages } from '~/presentation/web/pages/birthdays';
import { actor, fakeDirectory } from '../../fakes';

const channels = [
  { id: 'public', name: 'Public', kind: 'text' as const },
  { id: 'private', name: 'Private', kind: 'text' as const },
];
const member = actor();
const directory = fakeDirectory();
const server = serverOf(channels, []);

function appFor(pages: Hono<Env>) {
  const app = new Hono<Env>();

  app.use(async (c, next) => {
    c.set('actor', member);
    c.set('server', server);
    c.set('can', new Set(['announcement:create', 'birthday:manage'] as const));
    await next();
  });

  return app.route('/', pages);
}

it('hides private event and poll records from dashboard lists', async () => {
  directory.canView.mockImplementation(async (_actor, id) => id === 'public');
  const records = [
    {
      id: 1,
      channelId: 'public',
      title: 'Visible event',
      question: 'Visible poll',
      startsAt: new Date(),
      closesAt: null,
    },
    {
      id: 2,
      channelId: 'private',
      title: 'Secret event',
      question: 'Secret poll',
      startsAt: new Date(),
      closesAt: null,
    },
  ];
  const deps = {
    guildId: 'g',
    timezone: 'UTC',
    directory,
    services: {
      events: { upcoming: async () => records },
      polls: { open: async () => records },
    },
  } as unknown as WebDeps;

  for (const [pages, visible, hidden] of [
    [eventPages(deps), 'Visible event', 'Secret event'],
    [pollPages(deps), 'Visible poll', 'Secret poll'],
  ] as const) {
    const html = await (await appFor(pages).request('/')).text();

    expect(html).toContain(visible);
    expect(html).not.toContain(hidden);
    expect(html).not.toContain('#Private');
  }

  expect(await visibleRecords(directory, member, records)).toHaveLength(1);
});

it('preserves the channel and scheduling time through PSA previews', async () => {
  const deps = {
    guildId: 'g',
    timezone: 'UTC',
    services: {
      announcements: { view: () => ({ content: 'Hello' }) },
    },
  } as unknown as WebDeps;
  const response = await appFor(psaPages(deps)).request('/', {
    method: 'POST',
    body: new URLSearchParams({
      action: 'preview',
      channelId: 'private',
      content: 'Hello',
      when: 'tomorrow 9:00',
    }),
  });
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(html).toMatch(/value="private" selected/);
  expect(html).toContain('value="tomorrow 9:00"');
});

it('selects the saved birthday announcement channel', async () => {
  const deps = {
    guildId: 'g',
    directory,
    services: {
      birthdays: {
        settings: async () => ({ channelId: 'private', hour: 9, roleId: null }),
        upcoming: async () => [],
      },
    },
  } as unknown as WebDeps;
  const html = await (await appFor(birthdayPages(deps)).request('/')).text();

  expect(html).toMatch(/value="private" selected/);
});

it('submits explicit nulls when event fields are cleared', async () => {
  const edit = vi.fn(async () => undefined);
  const deps = {
    guildId: 'g',
    timezone: 'UTC',
    services: { events: { edit } },
  } as unknown as WebDeps;

  await appFor(eventPages(deps)).request('/1', {
    method: 'POST',
    body: new URLSearchParams({
      title: 'Event',
      description: '',
      location: '',
      capacity: '',
      end: '',
    }),
  });
  expect(edit).toHaveBeenCalledWith(
    member,
    1,
    expect.objectContaining({
      description: null,
      location: null,
      capacity: null,
      end: null,
    }),
  );
});
