import { createLogger, createLogStore } from '~/infra/logging';
import { createRegistry } from '~/app';
import { loadConfig } from '~/config';
import { registerCommands } from '~/infra/discord';

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
