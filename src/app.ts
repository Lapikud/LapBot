import { createEventSuggestionService } from '~/features/event-suggestions/service';
import { configureApplicationAdminRole } from '~/discord/interactions/actor';
import { createPostgresInfrastructure } from '~/integrations/db/infrastructure';
import type { AppInfrastructure } from '~/infrastructure';
import { randomBytes } from 'node:crypto';
import { Events, type Client } from 'discord.js';
import type { Config } from '~/config/env';
import { announcementCommands } from '~/discord/commands/announcements';
import { birthdayCommands } from '~/discord/commands/birthdays';
import { createClient } from '~/integrations/discord/client';
import { createGoogleCalendar } from '~/integrations/google/calendar';
import { eventCommands } from '~/discord/commands/events';
import { movieCommands } from '~/discord/commands/movies';
import { pollCommands } from '~/discord/commands/polls';
import { createInteractionHandler } from '~/discord/interactions/router';
import { buildRegistry, type Registry } from '~/discord/registry';
import { registerCommands } from '~/discord/registration';
import { createDiscordDirectory } from '~/integrations/discord/directory';
import { createDiscordMessenger } from '~/integrations/discord/messenger';
import { reminderCommands } from '~/discord/commands/reminders';
import { roleEvents } from '~/discord/events/roles';
import { permissionCommands } from '~/discord/commands/permissions';
import { createAnnouncementService } from '~/features/announcements/service';
import {
  createAuthorizer,
  createPermissionService,
} from '~/features/permissions/service';
import { createBirthdayService } from '~/features/birthdays/service';
import { createEventService } from '~/features/events/service';
import { createMovieService } from '~/features/movies/service';
import { createPollService } from '~/features/polls/service';
import { createReminderService } from '~/features/reminders/service';
import { createRoleService } from '~/features/roles/service';
import type { AppContext, Feature } from '~/discord/contracts';
import type { Logger } from 'pino';
import type { LogStore } from '~/integrations/logging/store';
import { systemClock } from '~/core/helpers/clock';
import type { Authorizer } from '~/core/ports/authorization';
import type { Directory } from '~/core/ports/directory';
import type { Job } from '~/core/ports/scheduler';
import { webAccess } from '~/core/permission';
import { createWebApp } from '~/web/app';
import { startWebServer } from '~/web/server';
import type { WebServices } from '~/web/context';
import { createTmdbCatalog } from '~/integrations/tmdb/catalog';

export function compose(
  config: Config,
  log: Logger,
  infrastructure: AppInfrastructure = createPostgresInfrastructure(
    config.DATABASE_URL,
    log,
  ),
) {
  configureApplicationAdminRole(
    config.JUHATUS_ROLE_ID,
    config.DISCORD_GUILD_ID,
  );
  const client = createClient();
  const grants = infrastructure.repositories.grants;
  const authz = createAuthorizer(grants);
  const directory = createDiscordDirectory(client);
  const messenger = createDiscordMessenger(client);
  const roles = createRoleService({
    panels: infrastructure.repositories.roles,
    directory,
    messenger,
    log: log.child({ service: 'roles' }),
  });
  const timezone = config.DEFAULT_TIMEZONE;
  const scheduler = infrastructure.scheduler;
  const reminders = createReminderService({
    reminders: infrastructure.repositories.reminders,
    scheduler,
    messenger,
    directory,
    authz,
    timezone,
  });
  const announcements = createAnnouncementService({
    posts: infrastructure.repositories.announcements,
    scheduler,
    messenger,
    directory,
    authz,
    log: log.child({ service: 'announcements' }),
    clock: systemClock,
    timezone,
  });
  const eventSuggestions = createEventSuggestionService({
    suggestions: infrastructure.repositories.eventSuggestions,
    authz,
    directory,
    messenger,
  });
  const events = createEventService({
    events: infrastructure.repositories.events,
    scheduler,
    messenger,
    ...(config.GOOGLE_CALENDAR_ID !== undefined &&
      config.GOOGLE_SERVICE_ACCOUNT_KEY !== undefined && {
        calendar: createGoogleCalendar(
          config.GOOGLE_CALENDAR_ID,
          config.GOOGLE_SERVICE_ACCOUNT_KEY,
        ),
      }),
    directory,
    authz,
    log: log.child({ service: 'events' }),
    timezone,
  });
  const polls = createPollService({
    polls: infrastructure.repositories.polls,
    scheduler,
    messenger,
    directory,
    authz,
    log: log.child({ service: 'polls' }),
    timezone,
  });
  const movies = createMovieService({
    catalog:
      config.TMDB_ACCESS_TOKEN === undefined
        ? undefined
        : createTmdbCatalog(config.TMDB_ACCESS_TOKEN),
    movies: infrastructure.repositories.movies,
    polls,
    events,
    authz,
    timezone,
  });
  const birthdays = createBirthdayService({
    birthdays: infrastructure.repositories.birthdays,
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
    roleEvents(roles, config.DISCORD_GUILD_ID),
    permissionCommands(permissions),
    reminderCommands(reminders),
    announcementCommands(announcements),
    eventCommands(events, directory, timezone, eventSuggestions),
    birthdayCommands(birthdays),
    pollCommands(polls, directory),
    movieCommands(movies),
    {
      name: 'web',
      permissions: [{ id: webAccess, description: 'Open the web dashboard' }],
    },
  ];

  const registry = buildRegistry(features);

  const runnerJobs = new Map<string, Job<unknown>>();

  for (const job of jobs) {
    if (runnerJobs.has(job.type)) {
      throw new Error(`Duplicate job type "${job.type}"`);
    }

    runnerJobs.set(job.type, job);
  }

  return {
    infrastructure,
    client,
    authz,
    registry,
    directory,
    jobs: runnerJobs,
    web: {
      eventSuggestions,
      announcements,
      events,
      polls,
      permissions,
      birthdays,
      movies,
      roles,
    },
  };
}

export function createRegistry(config: Config, log: Logger): Registry {
  return compose(config, log).registry;
}

async function startWeb(
  config: Config,
  deps: {
    directory: Directory;
    authz: Authorizer;
    services: WebServices;
    log: Logger;
    logs: LogStore;
  },
): Promise<() => Promise<void>> {
  const port = config.WEB_PORT;
  const guildId = config.DISCORD_GUILD_ID;
  const clientId = config.DISCORD_APPLICATION_ID;
  const clientSecret = config.DISCORD_CLIENT_SECRET;

  if (port === undefined || guildId === undefined) {
    return () => Promise.resolve();
  }

  if (clientId === undefined || clientSecret === undefined) {
    deps.log.warn(
      'Web UI is off: set DISCORD_APPLICATION_ID and DISCORD_CLIENT_SECRET for Discord sign-in',
    );

    return () => Promise.resolve();
  }

  const app = createWebApp({
    guildId,
    authz: deps.authz,
    timezone: config.DEFAULT_TIMEZONE,
    signIn: {
      clientId,
      clientSecret,
      publicUrl: config.WEB_URL ?? `http://localhost:${port}`,
      sessionSecret: config.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    },
    directory: deps.directory,
    services: deps.services,
    log: deps.log,
    logs: deps.logs,
  });

  return startWebServer(app, { port, host: config.WEB_HOST, log: deps.log });
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
  logs: LogStore,
): Promise<() => Promise<void>> {
  const { infrastructure, client, authz, registry, directory, jobs, web } =
    compose(config, log);
  const jobLog = log.child({ component: 'scheduler' });

  try {
    await infrastructure.migrate();
    await infrastructure.start();
    const ready = await waitForReady(client, config.DISCORD_TOKEN);

    await infrastructure.startJobs(jobs.values(), jobLog);

    await registerCommands(registry, {
      token: config.DISCORD_TOKEN,
      applicationId: ready.application.id,
      ...(config.DISCORD_GUILD_ID !== undefined && {
        guildId: config.DISCORD_GUILD_ID,
      }),
    });

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
        log.error({ error }, 'Interaction handler crashed');
      });
    });
    client.on(Events.Error, (error) => {
      log.error({ error }, 'Discord client error');
    });

    await Promise.all(
      registry.features.map(async (feature) => {
        try {
          await feature.start?.();
        } catch (error) {
          log.error(
            { error, feature: feature.name },
            'Feature failed to start',
          );
        }
      }),
    );

    const stopWeb = await startWeb(config, {
      directory,
      authz,
      services: web,
      log: log.child({ component: 'web' }),
      logs,
    });

    log.info(
      {
        user: ready.user.tag,
        features: registry.features.map((f) => f.name),
      },
      'Ready',
    );

    return async () => {
      client.removeAllListeners(Events.InteractionCreate);
      await stopWeb();
      await infrastructure.stop();
      await client.destroy();
      await infrastructure.close();
    };
  } catch (error) {
    await infrastructure.stop().catch(() => null);
    await client.destroy();
    await infrastructure.close();
    throw error;
  }
}
