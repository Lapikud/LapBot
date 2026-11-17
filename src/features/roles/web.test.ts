import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { rolePages } from './web';
import { serverOf, type Env, type WebDeps } from '~/integrations/web/context';
import { actor, role } from '../../../tests/fakes';

function setup(empty = false) {
  const save = vi.fn(async () => undefined);
  const deps = {
    services: {
      roles: {
        list: async () =>
          empty
            ? []
            : [
                {
                  channelId: 'c',
                  messageId: null,
                  roles: [{ roleId: 'r', emoji: '🎉', label: 'Team' }],
                },
              ],
        save,
      },
    },
  } as unknown as WebDeps;
  const app = new Hono<Env>();

  app.use(async (c, next) => {
    c.set('actor', actor({ administrator: true }));
    c.set(
      'server',
      serverOf(
        [{ id: 'c', name: 'roles', kind: 'text' }],
        [
          role({ name: 'Team' }),
          role({ id: 'other', name: 'Other' }),
          role({ id: 'admin', name: 'Unsafe', moderator: true }),
        ],
      ),
    );
    c.set('can', new Set<`${string}:${string}`>());
    await next();
  });
  app.route('/roles', rolePages(deps));

  return { app, save };
}

it('renders stored choices and excludes unsafe roles from the picker', async () => {
  const { app } = setup();
  const response = await app.request('/roles');
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(html).toContain('🎉');
  expect(html).toContain('Team');
  expect(html).not.toContain('Unsafe');
  expect(html).toContain('Save reaction panel');
});

it('posts selected choices to the shared role service and ignores cleared rows', async () => {
  const { app, save } = setup();
  const response = await app.request('/roles', {
    method: 'POST',
    body: new URLSearchParams({
      channelId: 'c',
      'role-0': 'r',
      'emoji-0': '🎉',
      'role-1': '',
      'emoji-1': '1️⃣',
    }),
  });

  expect(response.status).toBe(303);
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ administrator: true }),
    'c',
    [{ roleId: 'r', emoji: '🎉' }],
  );
});

it('shows only current choices and a single add-role control', async () => {
  const { app } = setup();
  const html = await (await app.request('/roles')).text();

  expect(html).toContain('Add role');
  expect(html).toContain('Remove Team');
  expect(html).not.toContain('role-19');
  expect(html).toContain('new-role');
});

it('adds a role with its suggested emoji', async () => {
  const { app, save } = setup();
  const response = await app.request('/roles', {
    method: 'POST',
    body: new URLSearchParams({
      channelId: 'c',
      'role-0': 'r',
      'emoji-0': '🎉',
      'new-role': 'other',
      'new-emoji': '1️⃣',
      action: 'add',
    }),
  });

  expect(response.status).toBe(303);
  expect(save).toHaveBeenCalledWith(expect.anything(), 'c', [
    { roleId: 'r', emoji: '🎉' },
    { roleId: 'other', emoji: '1️⃣' },
  ]);
});

it('removes a choice without requiring the add-role fields', async () => {
  const { app, save } = setup();
  const response = await app.request('/roles', {
    method: 'POST',
    body: new URLSearchParams({
      channelId: 'c',
      'role-0': 'r',
      'emoji-0': '🎉',
      remove: 'r',
    }),
  });

  expect(response.status).toBe(303);
  expect(save).toHaveBeenCalledWith(expect.anything(), 'c', []);
});

it('opens the first channel with an add control when no panel exists', async () => {
  const { app } = setup(true);
  const html = await (await app.request('/roles')).text();

  expect(html).toContain('No roles yet.');
  expect(html).toContain('name="channelId" value="c"');
  expect(html).toContain('Add role');
  expect(html).not.toContain('role-19');
});

it('removes all unavailable choices together', async () => {
  const { app, save } = setup();
  const response = await app.request('/roles', {
    method: 'POST',
    body: new URLSearchParams({
      channelId: 'c',
      'role-0': 'deleted-a',
      'emoji-0': '1️⃣',
      'role-1': 'deleted-b',
      'emoji-1': '2️⃣',
      'role-2': 'r',
      'emoji-2': '🎉',
      remove: 'unavailable',
    }),
  });

  expect(response.status).toBe(303);
  expect(save).toHaveBeenCalledWith(expect.anything(), 'c', [
    { roleId: 'r', emoji: '🎉' },
  ]);
});
