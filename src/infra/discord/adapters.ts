import {
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
} from 'discord.js';
import type { Calendar, Directory, Messenger } from '~/core/ports';
import { PermanentError } from '~/domain';
import { toActor, toRoleInfo } from './actor';
import { isPermanentDiscordError, isUnknownObject } from './errors';
import { render } from './render';

async function permanent<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isPermanentDiscordError(error) && error instanceof Error) {
      throw new PermanentError(error.message);
    }

    throw error;
  }
}

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

export function createDiscordDirectory(client: Client): Directory {
  const guild = (id: string): Promise<Guild> =>
    permanent(() => client.guilds.fetch(id));

  return {
    guildOf: async (channelId) => {
      const channel = await client.channels.fetch(channelId).catch(() => null);

      return channel && !channel.isDMBased() ? channel.guildId : undefined;
    },
    channels: async (guildId) => {
      const found = await guild(guildId);
      const all = await found.channels.fetch();

      return all
        .filter(
          (channel) =>
            channel?.type === ChannelType.GuildText ||
            channel?.type === ChannelType.GuildAnnouncement,
        )
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          kind:
            channel.type === ChannelType.GuildAnnouncement
              ? ('announcement' as const)
              : ('text' as const),
        }));
    },
    roles: async (guildId) => {
      const found = await guild(guildId);
      const roles = await found.roles.fetch();

      return roles
        .sort((a, b) => b.position - a.position)
        .map((role) => toRoleInfo(role));
    },
    role: async (guildId, roleId) => {
      const found = await guild(guildId);
      const role = await found.roles.fetch(roleId).catch(() => null);

      return role ? toRoleInfo(role) : undefined;
    },
    member: async (guildId, userId) => {
      const found = await guild(guildId);
      const member = await found.members.fetch(userId).catch(() => null);

      return member ? toActor(member) : undefined;
    },
    displayName: async (guildId, userId) => {
      const found = await guild(guildId);
      const member = await found.members.fetch(userId).catch(() => null);

      return member?.displayName;
    },
    canPost: async (actor, channelId) => {
      const found = await guild(actor.guildId);
      const [channel, member] = await Promise.all([
        found.channels.fetch(channelId).catch(() => null),
        found.members.fetch(actor.userId).catch(() => null),
      ]);

      if (!channel || !member) {
        return false;
      }

      return channel
        .permissionsFor(member)
        .has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ]);
    },
    addRoles: async ({ guildId, userId }, roleIds, reason) => {
      const found = await guild(guildId);
      const member = await permanent(() => found.members.fetch(userId));

      await permanent(() => member.roles.add([...roleIds], reason));
    },
    removeRoles: async ({ guildId, userId }, roleIds, reason) => {
      const found = await guild(guildId);
      const member = await permanent(() => found.members.fetch(userId));

      await permanent(() => member.roles.remove([...roleIds], reason));
    },
  };
}

export function createDiscordCalendar(client: Client): Calendar {
  return {
    upsert: async (guildId, id, event) => {
      const guild = await client.guilds.fetch(guildId);
      const details = {
        name: event.title.slice(0, 100),
        scheduledStartTime: event.startsAt,
        scheduledEndTime: event.endsAt,
        description: event.description.slice(0, 1000),
        entityMetadata: { location: event.location.slice(0, 100) },
      };

      if (id !== null) {
        await guild.scheduledEvents.edit(id, details);

        return id;
      }

      const created = await guild.scheduledEvents.create({
        ...details,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
      });

      return created.id;
    },
    remove: async (guildId, id) => {
      const guild = await client.guilds.fetch(guildId);

      await guild.scheduledEvents.delete(id);
    },
  };
}
