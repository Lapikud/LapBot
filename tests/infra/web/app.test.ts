import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '~/core/ports';
import {
  createAnnouncementService,
  createAuthorizer,
  createEventService,
  createPermissionService,
  createPollService,
} from '~/core/services';
import {
  createAnnouncementRepository,
  createEventRepository,
  createGrantRepository,
  createPollRepository,
} from '~/infra/db';
import type { Permission, PermissionDefinition } from '~/domain';
import { createWebApp, localOperator } from '~/infra/web';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';

const teamId = '123456789012345678';

describe.skipIf(noDatabase)('web UI', () => {
  const guildId = snowflake();
  const { messenger } = fakeMessenger();
  const directory = fakeDirectory([role({ id: teamId, name: 'Team' })]);
  let server: Server;
  let base = '';

  directory.channels.mockResolvedValue([
    { id: 'general', name: 'general', kind: 'text' },
  ]);

  beforeAll(async () => {
    const db = testDb();
    const scheduler = {
      schedule: vi.fn<Scheduler['schedule']>(async () => undefined),
      cancel: vi.fn<Scheduler['cancel']>(async () => undefined),
    };
    const authz = createAuthorizer(createGrantRepository(db));
    const shared = {
      scheduler,
      messenger,
      directory,
      authz,
      log: silentLog,
      timezone: 'Europe/Tallinn',
    };
    const app = createWebApp({
      guildId,
      auth: localOperator(async () => actor({ guildId, administrator: true })),
      directory,
      log: silentLog,
      services: {
        announcements: createAnnouncementService({
          ...shared,
          announcements: createAnnouncementRepository(db),
          clock: { now: () => new Date() },
        }),
        events: createEventService({
          ...shared,
          events: createEventRepository(db),
          calendar: { upsert: async () => 'n', remove: async () => undefined },
        }),
        polls: createPollService({
          ...shared,
          polls: createPollRepository(db),
        }),
        permissions: createPermissionService({
          grants: createGrantRepository(db),
          directory,
          authz,
          log: silentLog,
          known: () =>
            new Map<Permission, PermissionDefinition>([
              [
                'event:create',
                { id: 'event:create', description: 'Create events' },
              ],
            ]),
        }),
      },
    });

    server = createServer(
      (request, response) => void app.handle(request, response),
    );
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );

  const csrf = async (path: string) => {
    const page = await (await fetch(`${base}${path}`)).text();

    return /name="csrf" value="([0-9a-f]+)"/.exec(page)?.[1] ?? '';
  };

  const post = (path: string, fields: Record<string, string | string[]>) => {
    const body = new URLSearchParams();

    for (const [name, value] of Object.entries(fields)) {
      for (const item of [value].flat()) {
        body.append(name, item);
      }
    }

    return fetch(`${base}${path}`, {
      method: 'POST',
      body,
      redirect: 'manual',
    });
  };

  it('renders the PSA composer with channels and mentionable roles', async () => {
    const response = await fetch(`${base}/psa`);
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain('#general');
    expect(page).toContain('@Team');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
  });

  it('rejects forms without the CSRF token', async () => {
    const response = await post('/psa', {
      channelId: 'general',
      content: 'x',
      action: 'publish',
    });

    expect(response.status).toBe(403);
    expect(messenger.send).not.toHaveBeenCalled();
  });

  it('previews without posting, escaping user text', async () => {
    const response = await post('/psa', {
      csrf: await csrf('/psa'),
      channelId: 'general',
      title: '<b>Hi</b>',
      content: `Meeting <@&${teamId}> **now**`,
      role: teamId,
      embed: '1',
      action: 'preview',
    });
    const page = await response.text();

    expect(page).toContain('&lt;b&gt;Hi&lt;/b&gt;');
    expect(page).toMatch(/class="mention"\s*>@Team</);
    expect(messenger.send).not.toHaveBeenCalled();
  });

  it('publishes a PSA with the chosen role mentions', async () => {
    const response = await post('/psa', {
      csrf: await csrf('/psa'),
      channelId: 'general',
      title: 'Hackathon',
      content: 'Sign up today',
      role: teamId,
      embed: '1',
      action: 'publish',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('published');
    expect(messenger.send).toHaveBeenCalledWith(
      'general',
      expect.objectContaining({
        content: `<@&${teamId}>`,
        mentions: { everyone: false, roles: [teamId] },
      }),
    );
  });

  it('shows service errors as a message instead of failing', async () => {
    const response = await post('/psa', {
      csrf: await csrf('/psa'),
      channelId: 'general',
      content: ' ',
      action: 'draft',
    });

    expect(response.status).toBe(303);
    expect(
      decodeURIComponent(response.headers.get('location') ?? ''),
    ).toContain('error=');
  });

  it('creates polls', async () => {
    const poll = await post('/polls', {
      csrf: await csrf('/polls'),
      question: 'Lunch?',
      options: 'Pizza\nSushi',
      channelId: 'general',
    });

    expect(poll.status).toBe(303);
  });

  it('returns 404 for unknown pages', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
