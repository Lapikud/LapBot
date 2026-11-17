import {
  describe,
  expect,
  it,
  beforeAll,
  vi,
  afterAll,
  afterEach,
} from 'vitest';
import { checkDelegation } from '~/core/helpers/permissions';
import type { Actor } from '~/core/actor';
import { noDatabase, snowflake, testDb } from './db';
import {
  createAuthorizer,
  createPermissionService,
} from '~/features/permissions/service';
import {
  createGrantRepository,
  grant,
  listGrants,
  revoke,
} from '~/integrations/db/permissions/repository';
import type { GrantRepository } from '~/features/permissions/model';
import type { Permission, PermissionDefinition } from '~/core/permission';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from './fakes';
import { pino } from 'pino';
import { UserError } from '~/core/errors';
import type { Calendar } from '~/core/ports/calendar';
import type {
  AppContext,
  Feature,
  CommandInteraction,
  SlashCommand,
} from '~/discord/contracts';
import { createInteractionHandler } from '~/discord/interactions/router';
import { buildRegistry } from '~/discord/registry';
import type { Client } from 'discord.js';
import { createDiscordDirectory } from '~/integrations/discord/directory';
import { Hono } from 'hono';
import { setSignedCookie } from 'hono/cookie';
import { signedInUser, type SignIn } from '~/web/auth';
import { type Env, type WebDeps, serverOf } from '~/web/context';
import type { Scheduler } from '~/core/ports/scheduler';
import { createAnnouncementRepository } from '~/integrations/db/announcements/repository';
import { createAnnouncementService } from '~/features/announcements/service';
import { createBirthdayRepository } from '~/integrations/db/birthdays/repository';
import { createBirthdayService } from '~/features/birthdays/service';
import { createEventRepository } from '~/integrations/db/events/repository';
import {
  createEventService,
  type EventService,
} from '~/features/events/service';
import { createMovieRepository } from '~/integrations/db/movies/repository';
import { createMovieService } from '~/features/movies/service';
import { createPollRepository } from '~/integrations/db/polls/repository';
import { createPollService, type PollService } from '~/features/polls/service';
import { createRolePanelRepository } from '~/integrations/db/roles/repository';
import { createRoleService } from '~/features/roles/service';
import { createLogStore } from '~/integrations/logging/store';
import { createWebApp, type WebApp } from '~/web/app';
import { logRoutes } from '~/web/pages/settings/logs/routes';
import { createLogger } from '~/integrations/logging/logger';
import { eventCommands } from '~/discord/commands/events';
import { pollCommands } from '~/discord/commands/polls';
import { visibleRecords } from '~/core/helpers/visibility';
import { eventRoutes } from '~/web/pages/post/events/routes';
import { pollRoutes } from '~/web/pages/post/polls/routes';

describe('permission delegation', () => {
  const manager = (overrides: Partial<Actor> = {}): Actor => ({
    guildId: 'g',
    userId: 'u',
    roleIds: [],
    administrator: false,
    owner: false,
    highestRolePosition: 5,
    ...overrides,
  });

  describe('checkDelegation', () => {
    it('lets administrators grant anything', () => {
      expect(() =>
        checkDelegation({
          actor: manager({ administrator: true }),
          rolePosition: 99,
          permission: 'permissions:manage',
          actorHolds: false,
        }),
      ).not.toThrow();
    });

    it('never lets managers hand out permission management', () => {
      expect(() =>
        checkDelegation({
          actor: manager(),
          rolePosition: 1,
          permission: 'permissions:manage',
          actorHolds: true,
        }),
      ).toThrow('Only administrators');
    });

    it('only allows held permissions, for roles below the manager', () => {
      const delegate = (rolePosition: number, actorHolds: boolean) => () =>
        checkDelegation({
          actor: manager(),
          rolePosition,
          permission: 'event:create',
          actorHolds,
        });

      expect(delegate(1, true)).not.toThrow();
      expect(delegate(1, false)).toThrow('hold yourself');
      expect(delegate(5, true)).toThrow('below');
    });
  });
});

describe('permission grants', () => {
  function member(
    guildId: string,
    roleIds: string[],
    administrator = false,
  ): Actor {
    return {
      guildId,
      userId: 'u',
      roleIds,
      administrator,
      owner: false,
      highestRolePosition: 1,
    };
  }

  describe.skipIf(noDatabase)('authorizer', () => {
    const guildId = snowflake();
    const otherGuild = snowflake();
    const organizers = snowflake();
    const helpers = snowflake();

    beforeAll(async () => {
      const db = testDb();

      await grant(db, {
        guildId,
        roleId: organizers,
        permission: 'event:create',
        grantedBy: 'x',
      });
      await grant(db, {
        guildId,
        roleId: helpers,
        permission: 'poll:create',
        grantedBy: 'x',
      });
    });

    it('denies by default and allows granted roles', async () => {
      const authz = createAuthorizer(createGrantRepository(testDb()));

      expect(await authz.can(member(guildId, []), 'event:create')).toBe(false);
      expect(
        await authz.can(member(guildId, [organizers]), 'event:create'),
      ).toBe(true);
      expect(
        await authz.can(member(guildId, [organizers]), 'poll:create'),
      ).toBe(false);
    });

    it('combines grants from all roles of a member', async () => {
      const authz = createAuthorizer(createGrantRepository(testDb()));
      const both = member(guildId, [organizers, helpers]);

      expect(await authz.can(both, 'event:create')).toBe(true);
      expect(await authz.can(both, 'poll:create')).toBe(true);
    });

    it('lists only held permissions in one lookup', async () => {
      const authz = createAuthorizer(createGrantRepository(testDb()));
      const asked = ['event:create', 'poll:create', 'movie:manage'] as const;

      expect(
        await authz.granted(member(guildId, [organizers, helpers]), asked),
      ).toEqual(new Set(['event:create', 'poll:create']));
      expect(
        await authz.granted(member(otherGuild, [organizers]), asked),
      ).toEqual(new Set());
      expect(await authz.granted(member(guildId, [], true), asked)).toEqual(
        new Set(asked),
      );
    });

    it('isolates grants per guild', async () => {
      const authz = createAuthorizer(createGrantRepository(testDb()));

      expect(
        await authz.can(member(otherGuild, [organizers]), 'event:create'),
      ).toBe(false);
    });

    it('lets Discord administrators do everything', async () => {
      const authz = createAuthorizer(createGrantRepository(testDb()));

      expect(
        await authz.can(member(guildId, [], true), 'permissions:manage'),
      ).toBe(true);
    });

    it('stops allowing after revocation', async () => {
      const db = testDb();
      const authz = createAuthorizer(createGrantRepository(db));
      const roleId = snowflake();

      expect(
        await grant(db, {
          guildId,
          roleId,
          permission: 'movie:manage',
          grantedBy: 'x',
        }),
      ).toBe(true);
      expect(
        await grant(db, {
          guildId,
          roleId,
          permission: 'movie:manage',
          grantedBy: 'x',
        }),
      ).toBe(false);
      expect(await listGrants(db, guildId, roleId)).toEqual([
        { roleId, permission: 'movie:manage' },
      ]);
      expect(
        await revoke(db, { guildId, roleId, permission: 'movie:manage' }),
      ).toBe(true);
      expect(await authz.can(member(guildId, [roleId]), 'movie:manage')).toBe(
        false,
      );
    });
  });

  describe.skipIf(noDatabase)('atomic permission replacement', () => {
    it('rolls back revocations when a grant fails', async () => {
      const repo = createGrantRepository(testDb());
      const guildId = snowflake();
      const roleId = snowflake();

      await repo.grant({
        guildId,
        roleId,
        permission: 'event:create',
        grantedBy: 'u',
      });
      await expect(
        repo.apply({
          guildId,
          roleId,
          grantedBy: null as unknown as string,
          grant: ['poll:create'],
          revoke: ['event:create'],
        }),
      ).rejects.toThrow();
      expect(await repo.list(guildId, roleId)).toEqual([
        { roleId, permission: 'event:create' },
      ]);
      await repo.apply({
        guildId,
        roleId,
        grantedBy: 'u',
        grant: ['poll:create'],
        revoke: ['event:create'],
      });
      expect(await repo.list(guildId, roleId)).toEqual([
        { roleId, permission: 'poll:create' },
      ]);
    });
  });
});

describe('permission changes', () => {
  it('validates every permission change before writing any', async () => {
    const grants: GrantRepository = {
      holds: async () => false,
      held: async () => [],
      list: async () => [],
      grant: vi.fn(async () => true),
      revoke: vi.fn(async () => true),
      apply: vi.fn(async () => undefined),
    };
    const known = new Map<Permission, PermissionDefinition>([
      ['event:create', { id: 'event:create', description: '' }],
      ['poll:create', { id: 'poll:create', description: '' }],
    ]);
    const service = createPermissionService({
      grants,
      directory: fakeDirectory([role()]),
      log: silentLog,
      known: () => known,
      authz: {
        require: async () => undefined,
        can: async (_actor, p) => p !== 'poll:create',
        granted: async () => new Set(),
      },
    });

    await expect(
      service.setRole(actor(), 'r', ['event:create', 'poll:create']),
    ).rejects.toThrow();
    expect(grants.grant).not.toHaveBeenCalled();
    expect(grants.revoke).not.toHaveBeenCalled();
    expect(grants.apply).not.toHaveBeenCalled();
  });
});

describe('interaction permissions', () => {
  function context(allowed: boolean) {
    const require = vi.fn(async () => {
      if (!allowed) {
        throw new UserError('denied');
      }
    });
    const ctx = {
      log: pino({ level: 'silent' }),
      authz: { require, can: vi.fn() },
    } as unknown as AppContext;

    return { ctx, require };
  }

  function commandInteraction(commandName: string, subcommand: string | null) {
    return {
      inCachedGuild: () => true,
      isAutocomplete: () => false,
      isMessageContextMenuCommand: () => false,
      isChatInputCommand: () => true,
      isMessageComponent: () => false,
      isModalSubmit: () => false,
      commandName,
      guildId: 'g',
      user: { id: 'u' },
      member: {
        id: 'u',
        guild: { id: 'g', ownerId: 'o' },
        permissions: { has: () => false },
        roles: { cache: new Map(), highest: { position: 1 } },
      },
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => subcommand,
      },
      deferred: false,
      replied: false,
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    };
  }

  function componentInteraction(customId: string) {
    return {
      ...commandInteraction('', null),
      isChatInputCommand: () => false,
      isMessageComponent: () => true,
      customId,
    };
  }

  const execute = vi.fn(async () => undefined);
  const features: Feature[] = [
    {
      name: 'demo',
      commands: [
        {
          data: { name: 'demo', description: 'demo' },
          permissions: { manage: 'demo:manage' },
          execute,
        },
        {
          data: { name: 'boom', description: 'boom' },
          execute: async () => {
            throw new Error('kaboom');
          },
        },
      ],
      components: [
        { prefix: 'demo:press', permission: 'demo:manage', execute },
      ],
    },
  ];

  describe('interaction router', () => {
    const registry = buildRegistry(features);

    it('enforces declared permissions before executing', async () => {
      const { ctx, require } = context(false);

      execute.mockClear();
      const interaction = commandInteraction('demo', 'manage');

      await createInteractionHandler(registry, ctx)(interaction as never);
      expect(require).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u', guildId: 'g' }),
        'demo:manage',
      );
      expect(execute).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'denied' }),
      );
    });

    it('rechecks permissions on persistent components and passes arguments', async () => {
      const allowed = context(true);

      execute.mockClear();
      const interaction = componentInteraction('demo:press:42:x');

      await createInteractionHandler(
        registry,
        allowed.ctx,
      )(interaction as never);
      expect(allowed.require).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u' }),
        'demo:manage',
      );
      expect(execute).toHaveBeenCalledWith(
        interaction,
        ['42', 'x'],
        allowed.ctx,
      );
    });

    it('hides unexpected errors behind a reference', async () => {
      const { ctx } = context(true);
      const interaction = commandInteraction('boom', null);

      await createInteractionHandler(registry, ctx)(interaction as never);
      const [[reply]] = interaction.reply.mock.calls as unknown as [
        [{ content: string }],
      ];

      expect(reply.content).toMatch(
        /^Something went wrong\. Reference: `\w{8}`$/,
      );
    });
  });
});

describe('member refresh', () => {
  it('refreshes membership before constructing an authorization actor', async () => {
    const fetchMember = vi.fn(async () => ({
      id: 'u',
      guild: { id: 'g', ownerId: 'owner' },
      roles: {
        cache: new Map([['current-role', {}]]),
        highest: { position: 1 },
      },
      permissions: { has: () => false },
    }));
    const client = {
      guilds: { fetch: async () => ({ members: { fetch: fetchMember } }) },
    } as unknown as Client;
    const directory = createDiscordDirectory(client);

    expect(await directory.member('g', 'u')).toMatchObject({
      roleIds: ['current-role'],
      administrator: false,
    });
    expect(fetchMember).toHaveBeenCalledWith({ user: 'u', force: true });
    fetchMember.mockRejectedValueOnce(new Error('Unknown member'));
    expect(await directory.member('g', 'u')).toBeUndefined();
  });
});

describe('dashboard sessions', () => {
  const signIn = { sessionSecret: 'test-secret' } as SignIn;

  it('rejects expired and malformed sessions while accepting a fresh session', async () => {
    const app = new Hono<Env>();

    app.get('/cookie', async (c) => {
      await setSignedCookie(
        c,
        'session',
        c.req.query('value') ?? '',
        signIn.sessionSecret,
      );

      return c.text('');
    });
    app.get('/', async (c) =>
      c.text((await signedInUser(c, signIn)) ?? 'anonymous'),
    );

    for (const [value, expected] of [
      [
        JSON.stringify({ userId: '123', expiresAt: Date.now() + 60_000 }),
        '123',
      ],
      [
        JSON.stringify({ userId: '123', expiresAt: Date.now() - 1 }),
        'anonymous',
      ],
      [JSON.stringify({ userId: '123' }), 'anonymous'],
      ['123', 'anonymous'],
      ['broken', 'anonymous'],
    ]) {
      const issued = await app.request(
        `/cookie?value=${encodeURIComponent(value ?? '')}`,
      );
      const cookie = issued.headers.get('set-cookie')?.split(';')[0] ?? '';

      expect(
        await (await app.request('/', { headers: { cookie } })).text(),
      ).toBe(expected);
    }
  });
});

describe('dashboard access', () => {
  const teamId = '123456789012345678';

  describe.skipIf(noDatabase)('web UI', () => {
    const guildId = snowflake();
    const { messenger } = fakeMessenger();
    const directory = fakeDirectory([role({ id: teamId, name: 'Team' })]);
    let app: WebApp;

    let cookie = '';

    directory.channels.mockResolvedValue([
      { id: 'general', name: 'general', kind: 'text' },
    ]);
    directory.member.mockImplementation(async (_guild, userId) =>
      userId === '42'
        ? actor({ guildId, userId, administrator: true })
        : undefined,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.includes('/oauth2/token')
          ? Response.json({
              access_token: 't',
              expires_in: 60,
              scope: 'identify',
            })
          : Response.json({ user: { id: '42' } }),
      ),
    );

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    const cookiesOf = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');

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

      const events = createEventService({
        ...shared,
        events: createEventRepository(db),
      });
      const polls = createPollService({
        ...shared,
        polls: createPollRepository(db),
      });

      app = createWebApp({
        guildId,
        authz,
        timezone: 'Europe/Tallinn',
        signIn: {
          clientId: 'client',
          clientSecret: 'secret',
          publicUrl: 'http://localhost',
          sessionSecret: 'x'.repeat(32),
        },
        directory,
        log: silentLog,
        logs: createLogStore(':memory:'),
        services: {
          roles: createRoleService({
            panels: createRolePanelRepository(db),
            directory,
            messenger,
            log: silentLog,
          }),
          announcements: createAnnouncementService({
            ...shared,
            posts: createAnnouncementRepository(db),
            clock: { now: () => new Date() },
          }),
          events,
          polls,
          movies: createMovieService({
            movies: createMovieRepository(db),
            catalog: undefined,
            polls,
            events,
            authz,
            timezone: 'Europe/Tallinn',
          }),
          birthdays: createBirthdayService({
            ...shared,
            birthdays: createBirthdayRepository(db),
          }),
          permissions: createPermissionService({
            grants: createGrantRepository(db),
            directory,
            authz,
            log: silentLog,
            known: () =>
              new Map<Permission, PermissionDefinition>([
                [
                  'permissions:manage',
                  {
                    id: 'permissions:manage',
                    description: 'Manage permissions',
                  },
                ],
                [
                  'event:create',
                  { id: 'event:create', description: 'Create events' },
                ],
                [
                  'web:access',
                  { id: 'web:access', description: 'Open the dashboard' },
                ],
                [
                  'announcement:create',
                  { id: 'announcement:create', description: 'Write PSAs' },
                ],
                [
                  'announcement:publish',
                  { id: 'announcement:publish', description: 'Publish PSAs' },
                ],
              ]),
          }),
        },
      });
    });

    const get = (path: string) =>
      app.request(`http://localhost${path}`, { headers: { Cookie: cookie } });

    const post = (
      path: string,
      fields: Record<string, string | string[]>,
      origin = 'http://localhost',
    ) => {
      const body = new URLSearchParams();

      for (const [name, value] of Object.entries(fields)) {
        for (const item of [value].flat()) {
          body.append(name, item);
        }
      }

      return app.request(`http://localhost${path}`, {
        method: 'POST',
        body,
        headers: { Origin: origin, Cookie: cookie },
      });
    };

    it('sends visitors to Discord and signs members in', async () => {
      expect((await get('/')).headers.get('location')).toBe('/login');

      const start = await get('/login');
      const authorize = new URL(start.headers.get('location') ?? '');
      const state = authorize.searchParams.get('state') ?? '';
      const forged = await app.request(
        'http://localhost/login?code=c&state=forged',
        { headers: { Cookie: cookiesOf(start) } },
      );
      const done = await app.request(
        `http://localhost/login?code=c&state=${state}`,
        { headers: { Cookie: cookiesOf(start) } },
      );

      expect(authorize.host).toBe('discord.com');
      expect(forged.status).toBe(401);
      expect(done.headers.get('location')).toBe('/');

      cookie = cookiesOf(done);
      expect((await get('/')).status).toBe(200);
    });

    it('rejects forms posted from another site', async () => {
      const response = await post(
        '/post/announcements',
        { channelId: 'general', content: 'x', action: 'publish' },
        'https://evil.example',
      );

      expect(response.status).toBe(403);
      expect(messenger.send).not.toHaveBeenCalled();
    });

    it('previews without posting, escaping user text', async () => {
      const response = await post('/post/announcements', {
        channelId: 'general',
        title: '<b>Hi</b>',
        content: `Meeting <@&${teamId}> **now**`,
        role: teamId,
        action: 'preview',
      });
      const page = await response.text();

      expect(page).toContain('&lt;b&gt;Hi&lt;/b&gt;');
      expect(page).toMatch(/class="mention"\s*>@Team</);
      expect(messenger.send).not.toHaveBeenCalled();
    });

    it('keeps members without dashboard access out', async () => {
      directory.member.mockResolvedValueOnce(
        actor({ guildId, userId: '42', administrator: false }),
      );

      expect((await get('/')).status).toBe(403);
    });
  });
});

describe('log access', () => {
  const archives: Array<ReturnType<typeof createLogStore>> = [];

  function memoryLogs() {
    const logs = createLogStore(':memory:');

    archives.push(logs);

    return logs;
  }

  afterEach(() => {
    for (const logs of archives.splice(0)) {
      logs.close();
    }
  });

  function setup(administrator = true) {
    const logs = memoryLogs();
    const app = new Hono<Env>();

    logs.write(
      JSON.stringify({
        time: Date.now(),
        level: 30,
        msg: 'Ready',
        service: 'startup',
      }),
    );
    logs.write(
      JSON.stringify({
        time: Date.now(),
        level: 50,
        msg: '<script>alert(1)</script>',
        service: 'polls',
        err: { message: 'Discord unavailable' },
      }),
    );
    app.use(async (c, next) => {
      c.set('actor', actor({ administrator }));
      c.set('can', new Set(['permissions:manage'] as const));
      await next();
    });
    app.route('/settings/logs', logRoutes('UTC', logs));

    return app;
  }

  it('denies non-administrators even if a dashboard permission is present', async () => {
    const response = await setup(false).request('/settings/logs');

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Discord unavailable');
  });

  it('requires sign-in on the mounted dashboard route', async () => {
    const directory = fakeDirectory();
    const sessionSecret = 's'.repeat(32);
    const app = createWebApp({
      guildId: 'g',
      timezone: 'UTC',
      directory,
      authz: allowAll,
      log: silentLog,
      logs: memoryLogs(),
      signIn: {
        clientId: 'c',
        clientSecret: 's',
        publicUrl: 'http://localhost',
        sessionSecret,
      },
      services: {
        permissions: {
          catalogue: () => [
            { id: 'permissions:manage', description: 'Manage permissions' },
          ],
        },
      },
    } as unknown as WebDeps);
    const anonymous = await app.request('/settings/logs');

    expect(anonymous.status).toBe(303);
    expect(anonymous.headers.get('location')).toBe('/login');

    const issuer = new Hono().get('/', async (c) => {
      await setSignedCookie(
        c,
        'session',
        JSON.stringify({ userId: 'u', expiresAt: Date.now() + 60_000 }),
        sessionSecret,
      );

      return c.text('');
    });
    const issued = await issuer.request('/');
    const headers = {
      cookie: issued.headers.get('set-cookie')?.split(';')[0] ?? '',
    };

    directory.member.mockResolvedValue(actor({ administrator: false }));
    expect((await app.request('/settings/logs', { headers })).status).toBe(403);
    directory.member.mockResolvedValue(actor({ administrator: true }));
    expect((await app.request('/settings/logs', { headers })).status).toBe(200);
  });
});

describe('log redaction', () => {
  it('captures redacted structured entries, child context and serialized errors', () => {
    const logs = createLogStore(':memory:');
    const log = createLogger('info', logs).child({ service: 'polls' });

    log.debug('hidden by configured level');
    log.error(
      {
        token: 'root-secret',
        credentials: { password: 'nested-secret' },
        err: new Error('Discord unavailable'),
      },
      'Could not update poll',
    );
    const entries = logs.page({ level: 10, query: '' }).entries;

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 50,
      source: 'polls',
      message: 'Could not update poll',
    });
    expect(entries[0]?.details).toContain('Discord unavailable');
    expect(entries[0]?.details).toContain('[redacted]');
    expect(JSON.stringify(entries)).not.toContain('root-secret');
    expect(JSON.stringify(entries)).not.toContain('nested-secret');
    logs.close();
  });
});

describe('private records in Discord', () => {
  it('filters private events and polls from Discord lists and autocomplete', async () => {
    const directory = fakeDirectory();

    directory.canView.mockImplementation(async (_actor, id) => id === 'public');
    const records = ['public', 'private'].map((channelId, id) => ({
      id,
      channelId,
      title: channelId,
      question: channelId,
      startsAt: new Date(),
    }));
    const features = [
      eventCommands(
        { upcoming: async () => records } as unknown as EventService,
        directory,
        'UTC',
      ),
      pollCommands(
        { open: async () => records } as unknown as PollService,
        directory,
      ),
    ];
    const context: AppContext = { authz: allowAll, log: silentLog };

    for (const feature of features) {
      const command = feature.commands?.[0];

      if (!command?.autocomplete) {
        throw new Error('Missing command or autocomplete');
      }

      const reply = vi.fn<(message: { content: string }) => Promise<void>>(
        async () => undefined,
      );
      const respond = vi.fn();
      const interaction = {
        guildId: 'g',
        member: {
          id: 'u',
          guild: { id: 'g', ownerId: 'owner' },
          roles: { cache: new Map(), highest: { position: 1 } },
          permissions: { has: () => false },
        },
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'list',
          getFocused: () => ({ name: 'id', value: '' }),
        },
        reply,
        respond,
      };

      await command.execute(
        interaction as unknown as CommandInteraction,
        context,
      );
      expect(reply.mock.calls.at(0)?.[0].content).toContain('public');
      expect(reply.mock.calls.at(0)?.[0].content).not.toContain('private');
      await command.autocomplete(
        interaction as unknown as Parameters<
          NonNullable<SlashCommand['autocomplete']>
        >[0],
        context,
      );
      expect(respond).toHaveBeenCalledWith([{ name: '#0 public', value: 0 }]);
    }
  });
});

describe('club calendar privacy', () => {
  describe.skipIf(noDatabase)('event service', () => {
    const setup = () => {
      const directory = fakeDirectory();
      const calendar = {
        upsert: vi.fn<Calendar['upsert']>(async () => 'linked'),
        remove: vi.fn<Calendar['remove']>(async () => undefined),
        between: vi.fn<Calendar['between']>(async () => []),
      };
      const { messenger } = fakeMessenger();
      const service = createEventService({
        events: createEventRepository(testDb()),
        scheduler: {
          schedule: async () => undefined,
          cancel: async () => undefined,
        },
        messenger,
        calendar,
        directory,
        authz: allowAll,
        log: silentLog,
        timezone: 'UTC',
      });

      return {
        service,
        directory,
        calendar,
        messenger,
        member: actor({ guildId: snowflake() }),
      };
    };

    it('refuses to put private-channel events on the club calendar', async () => {
      const { service, directory, calendar, messenger, member } = setup();

      directory.isPublic.mockResolvedValue(false);
      await expect(
        service.create(member, {
          title: 'Board meeting',
          start: '3h',
          channelId: 'private',
          calendar: true,
        }),
      ).rejects.toBeInstanceOf(UserError);
      expect(calendar.upsert).not.toHaveBeenCalled();
      expect(messenger.send).not.toHaveBeenCalled();
    });

    it('lists only visible events for the day, once each', async () => {
      const { service, directory, calendar, member } = setup();
      const startsAt = new Date('2030-11-20T18:00:00Z');

      await service.create(member, {
        title: 'Quiz',
        start: '20.11.2030 18:00',
        channelId: 'public',
        calendar: true,
      });
      await service.create(member, {
        title: 'Secret',
        start: '20.11.2030 19:00',
        channelId: 'private',
      });
      directory.canView.mockImplementation(
        async (_actor, id) => id === 'public',
      );
      calendar.between.mockResolvedValue([
        { id: 'linked', title: 'Quiz', startsAt, allDay: false },
        { id: 'sauna', title: 'Sauna', startsAt, allDay: true },
      ]);

      const day = await service.sameDay(member, '20.11.2030 12:00');

      const titles = day.entries.map((entry) => entry.title);

      expect(titles).toHaveLength(2);
      expect(titles).toEqual(expect.arrayContaining(['Quiz', 'Sauna']));
    });
  });
});

describe('private records on the dashboard', () => {
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
      c.set(
        'can',
        new Set(['announcement:create', 'birthday:manage'] as const),
      );
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
      [eventRoutes(deps), 'Visible event', 'Secret event'],
      [pollRoutes(deps), 'Visible poll', 'Secret poll'],
    ] as const) {
      const html = await (await appFor(pages).request('/')).text();

      expect(html).toContain(visible);
      expect(html).not.toContain(hidden);
      expect(html).not.toContain('#Private');
    }

    expect(await visibleRecords(directory, member, records)).toHaveLength(1);
  });

  it('submits explicit nulls when event fields are cleared', async () => {
    const edit = vi.fn(async () => undefined);
    const deps = {
      guildId: 'g',
      timezone: 'UTC',
      services: { events: { edit } },
    } as unknown as WebDeps;

    await appFor(eventRoutes(deps)).request('/1', {
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
});

describe('safe settings', () => {
  const scheduler = {
    schedule: async () => undefined,
    cancel: async () => undefined,
  };

  async function setup(permissions: Permission[] = []) {
    const member = actor({ guildId: snowflake(), roleIds: ['staff'] });
    const grants = createGrantRepository(testDb());

    for (const permission of permissions) {
      await grants.grant({
        guildId: member.guildId,
        roleId: 'staff',
        permission,
        grantedBy: 'admin',
      });
    }

    const directory = fakeDirectory();
    const { messenger, messages } = fakeMessenger();
    const authz = createAuthorizer(grants);
    const announcements = createAnnouncementRepository(testDb());
    const birthdays = createBirthdayRepository(testDb());
    const shared = {
      scheduler,
      directory,
      messenger,
      authz,
      log: silentLog,
      timezone: 'UTC',
    };

    return {
      member,
      directory,
      messenger,
      messages,
      announcements,
      birthdays,
      announcementService: createAnnouncementService({
        ...shared,
        posts: announcements,
        clock: { now: () => new Date() },
      }),
      birthdayService: createBirthdayService({ ...shared, birthdays }),
    };
  }

  describe.skipIf(noDatabase)('audit security regressions', () => {
    it.each([
      { administrator: true, moderator: true },
      { moderator: true },
      { position: 10 },
      { position: 11 },
    ])('rejects unsafe birthday roles: %j', async (overrides) => {
      const { member, directory, birthdays, birthdayService } = await setup([
        'birthday:manage',
      ]);

      directory.role.mockResolvedValue(role(overrides));
      await expect(
        birthdayService.configure(member, { channelId: 'c', roleId: 'r' }),
      ).rejects.toThrow();
      expect(await birthdays.settings(member.guildId)).toBeUndefined();
    });

    it('rejects birthday channels the manager cannot post in', async () => {
      const { member, directory, birthdays, birthdayService } = await setup([
        'birthday:manage',
      ]);

      directory.canPost.mockResolvedValue(false);
      await expect(
        birthdayService.configure(member, { channelId: 'private' }),
      ).rejects.toThrow();
      expect(await birthdays.settings(member.guildId)).toBeUndefined();
    });
  });
});
