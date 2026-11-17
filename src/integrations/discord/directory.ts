import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
} from 'discord.js';
import type { Directory } from '~/foundation/directory';
import { toActor, toRoleInfo } from './actor';
import { permanent } from './errors';

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
      const member = await found.members
        .fetch({ user: userId, force: true })
        .catch(() => null);

      return member ? toActor(member) : undefined;
    },
    displayName: async (guildId, userId) => {
      const found = await guild(guildId);
      const member = await found.members.fetch(userId).catch(() => null);

      return member?.displayName;
    },
    canView: async (actor, channelId) => {
      const found = await guild(actor.guildId);
      const [channel, member] = await Promise.all([
        found.channels.fetch(channelId).catch(() => null),
        found.members.fetch(actor.userId).catch(() => null),
      ]);

      return (
        !!channel &&
        !!member &&
        channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)
      );
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
