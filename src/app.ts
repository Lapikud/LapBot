import { Events, type Client } from 'discord.js';
import type { Config } from '~/config';
import {
  createClient,
  createInteractionHandler,
  createAuthorizer,
  buildRegistry,
} from '~/infra/discord';
import type { AppContext, Feature, Registry } from '~/infra/discord';
import type { Logger } from '~/infra/logging';
import { createScheduler } from '~/infra/scheduler';
import { connectDatabase, runMigrations } from '~/infra/db';
import { announcementsFeature } from '~/features/announcements';
import { birthdaysFeature } from '~/features/birthdays';
import { eventsFeature } from '~/features/events';
import { moviesFeature } from '~/features/movies';
import { createPermissionsFeature } from '~/features/permissions';
import { pollsFeature } from '~/features/polls';
import { createRedmineFeature } from '~/features/redmine';
import { remindersFeature } from '~/features/reminders';
import { rolesFeature } from '~/features/roles';
import { settingsFeature } from '~/features/settings';

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
