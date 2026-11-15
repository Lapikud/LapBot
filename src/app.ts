import { Events, type Client } from 'discord.js';
import type { Config } from '~/config';
import {
  announcementCommands,
  createClient,
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
  settingsCommands,
} from '~/infra/discord';
import {
  createAnnouncementService,
  createAuthorizer,
  createEventService,
  createMovieService,
  createPollService,
  createPermissionService,
  createReminderService,
  createRoleService,
  createSettingsService,
  type LegacyPanel,
} from '~/core/services';
import type { AppContext, Feature, Registry } from '~/infra/discord';
import type { Logger } from '~/infra/logging';
import { createJobQueue, createScheduler } from '~/infra/scheduler';
import { systemClock, type Job } from '~/core/ports';
import {
  connectDatabase,
  createAnnouncementRepository,
  createEventRepository,
  createGrantRepository,
  createMovieRepository,
  createPollRepository,
  createReminderRepository,
  createRolePanelRepository,
  createSettingsRepository,
  runMigrations,
} from '~/infra/db';
import { birthdaysFeature } from '~/features/birthdays';
import { createRedmineFeature } from '~/features/redmine';

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
    authz,
    log: log.child({ service: 'roles' }),
    legacy: legacyPanel(config),
  });
  const settings = createSettingsService({
    settings: createSettingsRepository(database.db),
    authz,
    defaultTimezone: config.DEFAULT_TIMEZONE,
  });
  const scheduler = createJobQueue(database.db);
  const reminders = createReminderService({
    reminders: createReminderRepository(database.db),
    scheduler,
    messenger,
    directory,
    authz,
    timezone: (guildId) => settings.timezone(guildId),
  });
  const announcements = createAnnouncementService({
    announcements: createAnnouncementRepository(database.db),
    scheduler,
    messenger,
    directory,
    authz,
    log: log.child({ service: 'announcements' }),
    clock: systemClock,
    timezone: (guildId) => settings.timezone(guildId),
  });
  const events = createEventService({
    events: createEventRepository(database.db),
    scheduler,
    messenger,
    calendar: createDiscordCalendar(client),
    directory,
    authz,
    log: log.child({ service: 'events' }),
    timezone: (guildId) => settings.timezone(guildId),
  });
  const polls = createPollService({
    polls: createPollRepository(database.db),
    scheduler,
    messenger,
    directory,
    authz,
    log: log.child({ service: 'polls' }),
    timezone: (guildId) => settings.timezone(guildId),
  });
  const movies = createMovieService({
    movies: createMovieRepository(database.db),
    polls,
    events,
    authz,
    timezone: (guildId) => settings.timezone(guildId),
  });
  const jobs: Array<Job<unknown>> = [
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
    settingsCommands(settings),
    reminderCommands(reminders),
    announcementCommands(announcements),
    eventCommands(events),
    birthdaysFeature,
    pollCommands(polls),
    movieCommands(movies),
  ];
  const redmine = createRedmineFeature(config, reminders);

  if (redmine) {
    features.push(redmine);
  }

  const registry = buildRegistry(features);

  const runnerJobs = new Map(registry.jobs);

  for (const job of jobs) {
    if (runnerJobs.has(job.type)) {
      throw new Error(`Duplicate job type "${job.type}"`);
    }

    runnerJobs.set(job.type, job);
  }

  return { database, client, authz, registry, jobs: runnerJobs };
}

export function createRegistry(config: Config, log: Logger): Registry {
  return compose(config, log).registry;
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
  const { database, client, authz, registry, jobs } = compose(config, log);

  try {
    await runMigrations(database.db);
    const scheduler = createScheduler(
      database.db,
      jobs,
      log.child({ component: 'scheduler' }),
    );
    const ready = await waitForReady(client, config.DISCORD_TOKEN);
    const ctx: AppContext = {
      client: ready,
      db: database.db,
      log,
      config,
      authz,
      scheduler,
    };

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
          await feature.start?.({
            ...ctx,
            log: log.child({ feature: feature.name }),
          });
        } catch (error) {
          log.error(
            { err: error, feature: feature.name },
            'Feature failed to start',
          );
        }
      }),
    );
    scheduler.start(ctx);
    log.info(
      { user: ready.user.tag, features: registry.features.map((f) => f.name) },
      'Ready',
    );

    return async () => {
      client.removeAllListeners(Events.InteractionCreate);
      await scheduler.stop();
      await client.destroy();
      await database.close();
    };
  } catch (error) {
    await client.destroy();
    await database.close();
    throw error;
  }
}
