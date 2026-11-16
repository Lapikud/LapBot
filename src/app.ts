import { Events, type Client } from 'discord.js';
import type { Config } from '~/config';
import {
  announcementCommands,
  birthdayCommands,
  createClient,
  redmineCommands,
  createDiscordCalendar,
  eventCommands,
  movieCommands,
  pollCommands,
  createInteractionHandler,
  buildRegistry,
  createDiscordDirectory,
  createDiscordMessenger,
  reminderCommands,
  roleCommands,
  permissionCommands,
} from '~/infra/discord';
import {
  createAnnouncementService,
  createAuthorizer,
  createRedmineService,
  createBirthdayService,
  createEventService,
  createMovieService,
  createPollService,
  createPermissionService,
  createReminderService,
  createRoleService,
  type LegacyPanel,
} from '~/core/services';
import type { AppContext, Feature, Registry } from '~/infra/discord';
import type { Logger } from '~/infra/logging';
import { PgBoss } from 'pg-boss';
import { createJobQueue, startJobs } from '~/infra/scheduler';
import { systemClock, type Directory, type Job } from '~/core/ports';
import type { Actor } from '~/domain';
import {
  createWebApp,
  localOperator,
  startWebServer,
  type WebServices,
} from '~/infra/web';
import {
  connectDatabase,
  createAnnouncementRepository,
  createEventRepository,
  createBirthdayRepository,
  createGrantRepository,
  createTrackerRepository,
  createMovieRepository,
  createPollRepository,
  createReminderRepository,
  createRolePanelRepository,
  runMigrations,
} from '~/infra/db';
import { RedmineClient } from '~/infra/redmine';

function legacyPanel(config: Config): LegacyPanel | undefined {
  const channelId = config.ROLE_SELECTION_CHANNEL_ID;

  if (channelId === undefined) {
    return undefined;
  }

  const roles = [
    { emoji: '1️⃣', roleId: config.TARKVARA_ROLE_ID, label: 'Tarkvara' },
    { emoji: '2️⃣', roleId: config.HELPDESK_ROLE_ID, label: 'Helpdesk' },
    { emoji: '3️⃣', roleId: config.KULTUUR_ROLE_ID, label: 'Kultuur' },
  ].flatMap(({ roleId, ...rest }) =>
    roleId === undefined ? [] : [{ roleId, ...rest }],
  );

  return { channelId, roles };
}

export function compose(config: Config, log: Logger) {
  const database = connectDatabase(config.DATABASE_URL);
  const client = createClient();
  const grants = createGrantRepository(database.db);
  const authz = createAuthorizer(grants);
  const directory = createDiscordDirectory(client);
  const messenger = createDiscordMessenger(client);
  const roles = createRoleService({
    panels: createRolePanelRepository(database.db),
    directory,
    messenger,
    log: log.child({ service: 'roles' }),
    legacy: legacyPanel(config),
  });
  const timezone = config.DEFAULT_TIMEZONE;
  const boss = new PgBoss({ connectionString: config.DATABASE_URL });
  const scheduler = createJobQueue(boss);
  const reminders = createReminderService({
    reminders: createReminderRepository(database.db),
    scheduler,
    messenger,
    directory,
    authz,
    timezone,
  });
  const announcements = createAnnouncementService({
    announcements: createAnnouncementRepository(database.db),
    scheduler,
    messenger,
    directory,
    authz,
    log: log.child({ service: 'announcements' }),
    clock: systemClock,
    timezone,
  });
  const events = createEventService({
    events: createEventRepository(database.db),
    scheduler,
    messenger,
    calendar: createDiscordCalendar(client),
    directory,
    authz,
    log: log.child({ service: 'events' }),
    timezone,
  });
  const polls = createPollService({
    polls: createPollRepository(database.db),
    scheduler,
    messenger,
    directory,
    authz,
    log: log.child({ service: 'polls' }),
    timezone,
  });
  const movies = createMovieService({
    movies: createMovieRepository(database.db),
    polls,
    events,
    authz,
    timezone,
  });
  const birthdays = createBirthdayService({
    birthdays: createBirthdayRepository(database.db),
    scheduler,
    messenger,
    directory,
    authz,
    log: log.child({ service: 'birthdays' }),
    timezone,
  });
  const jobs: Array<Job<unknown>> = [
    ...birthdays.jobs,
    ...polls.jobs,
    ...reminders.jobs,
    ...announcements.jobs,
    ...events.jobs,
  ];
  const permissions = createPermissionService({
    grants,
    directory,
    authz,
    log: log.child({ service: 'permissions' }),
    known: () => registry.permissions,
  });
  const features: Feature[] = [
    roleCommands(roles),
    permissionCommands(permissions),
    reminderCommands(reminders),
    announcementCommands(announcements),
    eventCommands(events),
    birthdayCommands(birthdays),
    pollCommands(polls),
    movieCommands(movies),
  ];

  if (
    config.REDMINE_BASE_URL !== undefined &&
    config.REDMINE_API_KEY !== undefined
  ) {
    const redmine = createRedmineService({
      baseUrl: config.REDMINE_BASE_URL,
      client: new RedmineClient(
        config.REDMINE_BASE_URL,
        config.REDMINE_API_KEY,
      ),
      tracker: createTrackerRepository(database.db),
      scheduler,
      messenger,
      authz,
      log,
      timezone,
    });

    features.push(redmineCommands(redmine));
    jobs.push(...redmine.jobs);
  }

  const registry = buildRegistry(features);

  const runnerJobs = new Map<string, Job<unknown>>();

  for (const job of jobs) {
    if (runnerJobs.has(job.type)) {
      throw new Error(`Duplicate job type "${job.type}"`);
    }

    runnerJobs.set(job.type, job);
  }

  return {
    database,
    boss,
    client,
    authz,
    registry,
    directory,
    jobs: runnerJobs,
    web: { announcements, events, polls, permissions, birthdays },
  };
}

export function createRegistry(config: Config, log: Logger): Registry {
  return compose(config, log).registry;
}

async function startWeb(
  config: Config,
  deps: {
    directory: Directory;
    services: WebServices;
    botUserId: string;
    log: Logger;
  },
): Promise<() => Promise<void>> {
  const guildId = config.DISCORD_GUILD_ID;

  if (config.WEB_PORT === undefined || guildId === undefined) {
    return () => Promise.resolve();
  }

  const operator = async (): Promise<Actor> => {
    const bot = await deps.directory.member(guildId, deps.botUserId);

    if (!bot) {
      throw new Error('The bot is not a member of DISCORD_GUILD_ID');
    }

    return { ...bot, administrator: true };
  };

  const app = createWebApp({
    guildId,
    timezone: config.DEFAULT_TIMEZONE,
    auth: localOperator(operator),
    directory: deps.directory,
    services: deps.services,
    log: deps.log,
  });

  return startWebServer(app, {
    port: config.WEB_PORT,
    host: config.WEB_HOST,
    log: deps.log,
  });
}

function waitForReady(client: Client, token: string): Promise<Client<true>> {
  return new Promise((resolve, reject) => {
    client.once(Events.ClientReady, resolve);
    client.login(token).catch(reject);
  });
}

export async function startApp(
  config: Config,
  log: Logger,
): Promise<() => Promise<void>> {
  const { database, boss, client, authz, registry, directory, jobs, web } =
    compose(config, log);
  const jobLog = log.child({ component: 'scheduler' });

  boss.on('error', (error) => {
    jobLog.error({ err: error }, 'Job queue error');
  });

  try {
    await runMigrations(database.db);
    await boss.start();
    const ready = await waitForReady(client, config.DISCORD_TOKEN);

    await startJobs(boss, jobs.values(), jobLog);

    const ctx: AppContext = { log, authz };

    for (const feature of registry.features) {
      for (const listener of feature.events ?? []) {
        listener.attach(client, {
          ...ctx,
          log: log.child({ feature: feature.name }),
        });
      }
    }

    const handleInteraction = createInteractionHandler(registry, ctx);

    client.on(Events.InteractionCreate, (interaction) => {
      handleInteraction(interaction).catch((error: unknown) => {
        log.error({ err: error }, 'Interaction handler crashed');
      });
    });
    client.on(Events.Error, (error) => {
      log.error({ err: error }, 'Discord client error');
    });

    await Promise.all(
      registry.features.map(async (feature) => {
        try {
          await feature.start?.();
        } catch (error) {
          log.error(
            { err: error, feature: feature.name },
            'Feature failed to start',
          );
        }
      }),
    );

    const stopWeb = await startWeb(config, {
      directory,
      services: web,
      botUserId: ready.user.id,
      log: log.child({ component: 'web' }),
    });

    log.info(
      { user: ready.user.tag, features: registry.features.map((f) => f.name) },
      'Ready',
    );

    return async () => {
      client.removeAllListeners(Events.InteractionCreate);
      await stopWeb();
      await boss.stop();
      await client.destroy();
      await database.close();
    };
  } catch (error) {
    await boss.stop().catch(() => null);
    await client.destroy();
    await database.close();
    throw error;
  }
}
