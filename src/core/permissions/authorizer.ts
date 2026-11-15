import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { Db } from '../../db/client.js';
import { UserError } from '../../shared/errors.js';
import type { Authorizer, Permission } from '../feature.js';
import { hasGrant } from './store.js';

/**
 * Members with Discord's Administrator permission (which includes the guild
 * owner) hold every bot permission. Everyone else needs a grant on one of
 * their roles; granting to @everyone makes an action open to all members.
 */
export function isAdministrator(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export function createAuthorizer(db: Db): Authorizer {
  const can = async (member: GuildMember, permission: Permission) =>
    isAdministrator(member) ||
    hasGrant(db, member.guild.id, [...member.roles.cache.keys()], permission);

  return {
    can,
    require: async (member, permission) => {
      if (!(await can(member, permission))) {
        throw new UserError(
          `You need the \`${permission}\` permission for this.`,
        );
      }
    },
  };
}

/**
 * Bot permissions never extend a member's reach: they may only direct the
 * bot to post where they could post themselves.
 */
export function requireCanPost(member: GuildMember, channelId: string): void {
  const channel = member.guild.channels.cache.get(channelId);
  const allowed = channel
    ?.permissionsFor(member)
    .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
  if (allowed !== true) {
    throw new UserError(`You cannot post in <#${channelId}> yourself.`);
  }
}
