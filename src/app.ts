import { Events, type Client } from 'discord.js';
import type { Config } from './core/config.js';
import { createClient } from './core/discord/client.js';
import { createInteractionHandler } from './core/discord/router.js';
import type { AppContext, Feature } from './core/feature.js';
import type { Logger } from './core/logger.js';
import { createAuthorizer } from './core/permissions/authorizer.js';
import { buildRegistry, type Registry } from './core/registry.js';
import { createScheduler } from './core/scheduler/scheduler.js';
import { connectDatabase, runMigrations } from './db/client.js';
import { announcementsFeature } from './features/announcements/index.js';
import { birthdaysFeature } from './features/birthdays/index.js';
import { eventsFeature } from './features/events/index.js';
import { moviesFeature } from './features/movies/index.js';
import { createPermissionsFeature } from './features/permissions/index.js';
import { pollsFeature } from './features/polls/index.js';
import { createRedmineFeature } from './features/redmine/index.js';
import { remindersFeature } from './features/reminders/index.js';
import { rolesFeature } from './features/roles/index.js';
import { settingsFeature } from './features/settings/index.js';

/**
 * The composition root: every feature the bot runs is listed here. Removing
 * a line disables that feature; its pending jobs stay in the database.
 */
export function createRegistry(config: Config): Registry {
  const features: Feature[] = [
    rolesFeature,
    createPermissionsFeature(() => registry.permissions),
    settingsFeature,
    remindersFeature,
    announcementsFeature,
    eventsFeature,
    birthdaysFeature,
    pollsFeature,
    moviesFeature,
  ];
  const redmine = createRedmineFeature(config);
  if (redmine) {
    features.push(redmine);
  }
  const registry = buildRegistry(features);
  return registry;
}

function waitForReady(client: Client, token: string): Promise<Client<true>> {
  return new Promise((resolve, reject) => {
    client.once(Events.ClientReady, resolve);
    client.login(token).catch(reject);
  });
}

/** Starts the bot and returns a function that shuts it down gracefully. */
export async function startApp(
  config: Config,
  log: Logger,
): Promise<() => Promise<void>> {
  const registry = createRegistry(config);
  const database = connectDatabase(config.DATABASE_URL);
  const client = createClient();

  try {
    await runMigrations(database.db);
    const scheduler = createScheduler(
      database.db,
      registry.jobs,
      log.child({ component: 'scheduler' }),
    );
    const ready = await waitForReady(client, config.DISCORD_TOKEN);
    const ctx: AppContext = {
      client: ready,
      db: database.db,
      log,
      config,
      authz: createAuthorizer(database.db),
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

    // A feature that fails to start is logged, not fatal to the others.
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
