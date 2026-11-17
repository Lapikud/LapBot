import { createLogger } from '~/integrations/logging/logger';
import { createLogStore } from '~/integrations/logging/store';
import { createRegistry } from '~/app';
import { loadConfig } from '~/config/env';
import { registerCommands } from '~/presentation/discord/registration';

const config = loadConfig();

if (config.DISCORD_APPLICATION_ID === undefined) {
  throw new Error('DISCORD_APPLICATION_ID is required to register commands');
}

const logs = createLogStore(config.LOG_DATABASE_PATH);

try {
  const count = await registerCommands(
    createRegistry(config, createLogger('warn', logs)),
    {
      token: config.DISCORD_TOKEN,
      applicationId: config.DISCORD_APPLICATION_ID,
      guildId: config.DISCORD_GUILD_ID,
    },
  );
  const scope =
    config.DISCORD_GUILD_ID === undefined
      ? 'globally'
      : `in guild ${config.DISCORD_GUILD_ID}`;

  console.log(`Registered ${count} commands ${scope}.`);
} finally {
  logs.close();
}
