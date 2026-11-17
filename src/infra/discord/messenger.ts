import {
  PermissionFlagsBits,
  type Client,
  type GuildTextBasedChannel,
} from 'discord.js';
import { PermanentError, UserError } from '~/domain';
import type { Messenger } from '~/core/ports';
import { permanent, isUnknownObject } from './errors';
import { render } from './render';
async function orFalse(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();

    return true;
  } catch (error) {
    if (isUnknownObject(error)) {
      return false;
    }

    throw error;
  }
}

export function createDiscordMessenger(client: Client): Messenger {
  const textChannel = async (id: string): Promise<GuildTextBasedChannel> => {
    const channel = await permanent(() => client.channels.fetch(id));

    if (channel?.isTextBased() !== true || channel.isDMBased()) {
      throw new PermanentError(`Channel ${id} is not a server text channel`);
    }

    return channel;
  };

  return {
    send: async (channelId, message) => {
      const channel = await textChannel(channelId);
      const sent = await permanent(() => channel.send(render(message)));

      return { channelId, messageId: sent.id };
    },
    edit: (channelId, messageId, message) =>
      orFalse(async () => {
        const channel = await textChannel(channelId);

        await channel.messages.edit(messageId, render(message));
      }),
    remove: (channelId, messageId) =>
      orFalse(async () => {
        const channel = await textChannel(channelId);

        await channel.messages.delete(messageId);
      }),
    direct: async (userId, message) => {
      const user = await permanent(() => client.users.fetch(userId));

      await permanent(() => user.send(render(message)));
    },
    exists: (channelId, messageId) =>
      orFalse(async () => {
        const channel = await textChannel(channelId);

        await channel.messages.fetch(messageId);
      }),
    findOwn: async (channelId, content) => {
      const channel = await textChannel(channelId);
      const recent = await channel.messages.fetch({ limit: 50 });

      return recent.find(
        (message) =>
          message.author.id === client.user?.id && message.content === content,
      )?.id;
    },
    clearReactionsExcept: async (channelId, messageId, emojis) => {
      await orFalse(async () => {
        const channel = await textChannel(channelId);
        const message = await channel.messages.fetch(messageId);
        const obsolete = [...message.reactions.cache.values()].filter(
          (reaction) => !emojis.includes(reaction.emoji.name ?? ''),
        );

        if (obsolete.length === 0) {
          return;
        }

        const bot = await channel.guild.members.fetchMe();

        if (
          !channel.permissionsFor(bot).has(PermissionFlagsBits.ManageMessages)
        ) {
          throw new UserError(
            'Give the bot Manage Messages in this channel to remove old panel reactions, then save again.',
          );
        }

        await Promise.all(obsolete.map((reaction) => reaction.remove()));
      });
    },
    ownReactions: async (channelId, messageId) => {
      const channel = await textChannel(channelId);
      const message = await channel.messages.fetch(messageId);

      return message.reactions.cache
        .filter((reaction) => reaction.me)
        .map((reaction) => reaction.emoji.name ?? '');
    },
    react: async (channelId, messageId, emoji) => {
      const channel = await textChannel(channelId);
      const message = await channel.messages.fetch(messageId);

      await message.react(emoji);
    },
  };
}
