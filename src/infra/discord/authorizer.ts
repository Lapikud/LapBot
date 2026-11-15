import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { Db } from '~/infra/db';
import { UserError } from '~/domain';
import type { Authorizer, Permission } from './module';
import { hasGrant } from '~/infra/db';

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

export function requireCanPost(member: GuildMember, channelId: string): void {
  const channel = member.guild.channels.cache.get(channelId);
  const allowed = channel
    ?.permissionsFor(member)
    .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);

  if (allowed !== true) {
    throw new UserError(`You cannot post in <#${channelId}> yourself.`);
  }
}
