import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * Only non-privileged intents are requested. Members are fetched over REST
 * when needed, so the GuildMembers and MessageContent intents are not used.
 * Partials let reaction events arrive for messages sent before a restart.
 */
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
    ],
    allowedMentions: { parse: [] },
  });
}
