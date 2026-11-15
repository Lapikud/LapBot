import { PermissionFlagsBits, type GuildMember, type Role } from 'discord.js';
import { UserError } from '../../shared/errors.js';

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

/** Why the bot must not hand this role out, or undefined when it may. */
export function selfAssignProblem(role: Role): string | undefined {
  if (role.id === role.guild.id) {
    return 'is the @everyone role';
  }
  if (role.managed) {
    return 'is managed by an integration';
  }
  if (moderatorPermissions.some((flag) => role.permissions.has(flag))) {
    return 'grants moderator permissions';
  }
  if (!role.editable) {
    return 'is above my highest role, or I lack Manage Roles';
  }
  return undefined;
}

export function requireSelfAssignable(role: Role): void {
  const problem = selfAssignProblem(role);
  if (problem !== undefined) {
    throw new UserError(`${role.name} cannot be self-assigned: it ${problem}.`);
  }
}

/** Members may only manage roles strictly below their own highest role. */
export function requireAbove(actor: GuildMember, role: Role): void {
  if (actor.id === actor.guild.ownerId) {
    return;
  }
  if (actor.roles.highest.comparePositionTo(role) <= 0) {
    throw new UserError(`${role.name} is not below your highest role.`);
  }
}

export function requireEditable(role: Role): void {
  if (role.managed || !role.editable) {
    throw new UserError(
      `I cannot manage ${role.name}: it is managed or above my highest role.`,
    );
  }
}
