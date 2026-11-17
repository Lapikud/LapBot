import { PermissionFlagsBits, type GuildMember, type Role } from 'discord.js';
import type { Actor } from '~/core/actor';
import type { RoleInfo } from '~/core/ports/directory';

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

let applicationAdminRole:
  { roleId: string; guildId: string | undefined } | undefined;

export function configureApplicationAdminRole(
  roleId?: string,
  guildId?: string,
): void {
  applicationAdminRole = roleId === undefined ? undefined : { roleId, guildId };
}

export function toActor(member: GuildMember): Actor {
  return {
    guildId: member.guild.id,
    userId: member.id,
    roleIds: [...member.roles.cache.keys()],
    administrator:
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      (applicationAdminRole !== undefined &&
        (applicationAdminRole.guildId === undefined ||
          applicationAdminRole.guildId === member.guild.id) &&
        member.roles.cache.has(applicationAdminRole.roleId)),
    owner: member.id === member.guild.ownerId,
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
    moderator:
      moderatorPermissions.some((flag) => role.permissions.has(flag)) ||
      (role.id === applicationAdminRole?.roleId &&
        (applicationAdminRole.guildId === undefined ||
          role.guild.id === applicationAdminRole.guildId)),
    administrator: role.permissions.has(PermissionFlagsBits.Administrator),
    botCanAssign: role.editable,
  };
}
