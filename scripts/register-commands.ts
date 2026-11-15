import { createRegistry } from '~/app';
import { loadConfig } from '~/core/config';
import { registerCommands } from '~/core/discord/registration';

const config = loadConfig();

if (config.DISCORD_APPLICATION_ID === undefined) {
  throw new Error('DISCORD_APPLICATION_ID is required to register commands');
}

const count = await registerCommands(createRegistry(config), {
  token: config.DISCORD_TOKEN,
  applicationId: config.DISCORD_APPLICATION_ID,
  guildId: config.DISCORD_GUILD_ID,
});
const scope =
  config.DISCORD_GUILD_ID === undefined
    ? 'globally'
    : `in guild ${config.DISCORD_GUILD_ID}`;

console.log(`Registered ${count} commands ${scope}.`);
