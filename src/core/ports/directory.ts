import type { Actor } from '~/core/actor';

export interface ChannelInfo {
  id: string;
  name: string;
  kind: 'text' | 'announcement';
}

export interface Directory {
  guildOf: (channelId: string) => Promise<string | undefined>;
  channels: (guildId: string) => Promise<ChannelInfo[]>;
  roles: (guildId: string) => Promise<RoleInfo[]>;
  role: (guildId: string, roleId: string) => Promise<RoleInfo | undefined>;
  member: (guildId: string, userId: string) => Promise<Actor | undefined>;
  displayName: (guildId: string, userId: string) => Promise<string | undefined>;
  canView: (actor: Actor, channelId: string) => Promise<boolean>;
  canPost: (actor: Actor, channelId: string) => Promise<boolean>;
  isPublic: (guildId: string, channelId: string) => Promise<boolean>;
  addRoles: (
    member: { guildId: string; userId: string },
    roleIds: readonly string[],
    reason: string,
  ) => Promise<void>;
  removeRoles: (
    member: { guildId: string; userId: string },
    roleIds: readonly string[],
    reason: string,
  ) => Promise<void>;
}

export interface RoleInfo {
  id: string;
  name: string;
  position: number;
  everyone: boolean;
  managed: boolean;
  mentionable: boolean;
  moderator: boolean;
  administrator: boolean;
  botCanAssign: boolean;
}
