import { REST, Routes } from 'discord.js';
import type { Registry } from './registry';

export async function registerCommands(
  registry: Registry,
  options: {
    token: string;
    applicationId: string;
    guildId?: string;
  },
): Promise<number> {
  const body = [
    ...[...registry.commands.values()].map((command) => command.data),
    ...[...registry.messageCommands.values()].map((command) => command.data),
  ];
  const rest = new REST().setToken(options.token);
  const route =
    options.guildId === undefined
      ? Routes.applicationCommands(options.applicationId)
      : Routes.applicationGuildCommands(options.applicationId, options.guildId);

  await rest.put(route, { body });

  return body.length;
}
