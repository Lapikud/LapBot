import { PermissionFlagsBits, type GuildMember, type Role } from 'discord.js';
import type { Actor, RoleInfo } from '~/domain';

const moderatorPermissions = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
];

export function toActor(member: GuildMember): Actor {
  return {
    guildId: member.guild.id,
    userId: member.id,
    roleIds: [...member.roles.cache.keys()],
    administrator: member.permissions.has(PermissionFlagsBits.Administrator),
    owner: member.id === member.guild.ownerId,
    mentionEveryone: member.permissions.has(
      PermissionFlagsBits.MentionEveryone,
    ),
    highestRolePosition: member.roles.highest.position,
  };
}

export function toRoleInfo(role: Role): RoleInfo {
  return {
    id: role.id,
    name: role.name,
    position: role.position,
    everyone: role.id === role.guild.id,
    managed: role.managed,
    mentionable: role.mentionable,
    moderator: moderatorPermissions.some((flag) => role.permissions.has(flag)),
    administrator: role.permissions.has(PermissionFlagsBits.Administrator),
    botCanAssign: role.editable,
  };
}
