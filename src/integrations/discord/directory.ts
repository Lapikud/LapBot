import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
} from 'discord.js';
import type { Directory, MemberInfo } from '~/core/ports/directory';
import { toActor, toRoleInfo } from '~/discord/interactions/actor';
import { isPermanentDiscordError, permanent } from './errors';

function absentOrThrow(error: unknown): null {
  if (isPermanentDiscordError(error)) {
    return null;
  }

  throw error;
}

export function createDiscordDirectory(client: Client): Directory {
  const guild = (id: string): Promise<Guild> =>
    permanent(() => client.guilds.fetch(id));

  return {
    guildOf: async (channelId) => {
      const channel = await client.channels
        .fetch(channelId)
        .catch(absentOrThrow);

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
    members: async (guildId) => {
      const found = await guild(guildId);
      const from = async (after?: string): Promise<MemberInfo[]> => {
        const page = await found.members
          .list({
            limit: 1000,
            cache: false,
            ...(after !== undefined && { after }),
          })
          .catch(absentOrThrow);

        if (page === null) {
          return [];
        }

        const members = page
          .filter((member) => !member.user.bot)
          .map((member) => ({
            id: member.id,
            name: member.displayName,
            username: member.user.username,
          }));

        return page.size === 1000
          ? [...members, ...(await from(page.lastKey()))]
          : members;
      };

      return from();
    },
    role: async (guildId, roleId) => {
      const found = await guild(guildId);
      const role = await found.roles.fetch(roleId).catch(absentOrThrow);

      return role ? toRoleInfo(role) : undefined;
    },
    member: async (guildId, userId) => {
      const found = await guild(guildId);
      const member = await found.members
        .fetch({ user: userId, force: true })
        .catch(absentOrThrow);

      return member ? toActor(member) : undefined;
    },
    displayName: async (guildId, userId) => {
      const found = await guild(guildId);
      const member = await found.members.fetch(userId).catch(absentOrThrow);

      return member?.displayName;
    },
    canView: async (actor, channelId) => {
      const found = await guild(actor.guildId);
      const [channel, member] = await Promise.all([
        found.channels.fetch(channelId).catch(absentOrThrow),
        found.members.fetch(actor.userId).catch(absentOrThrow),
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
        found.channels.fetch(channelId).catch(absentOrThrow),
        found.members.fetch(actor.userId).catch(absentOrThrow),
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
    canMentionEveryone: async (actor, channelId) => {
      const found = await guild(actor.guildId);
      const [channel, member] = await Promise.all([
        found.channels.fetch(channelId).catch(absentOrThrow),
        found.members.fetch(actor.userId).catch(absentOrThrow),
      ]);

      return (
        !!channel &&
        !!member &&
        channel.permissionsFor(member).has(PermissionFlagsBits.MentionEveryone)
      );
    },
    isPublic: async (guildId, channelId) => {
      const found = await guild(guildId);
      const channel = await found.channels
        .fetch(channelId)
        .catch(absentOrThrow);

      return (
        !!channel &&
        channel
          .permissionsFor(found.roles.everyone)
          .has(PermissionFlagsBits.ViewChannel)
      );
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
