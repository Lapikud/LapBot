import type { Actor, Message, RoleInfo } from '~/domain';

export type Sent = { channelId: string; messageId: string };

export type ChannelInfo = {
  id: string;
  name: string;
  kind: 'text' | 'announcement';
};

export type Messenger = {
  send: (channelId: string, message: Message) => Promise<Sent>;
  edit: (
    channelId: string,
    messageId: string,
    message: Message,
  ) => Promise<boolean>;
  remove: (channelId: string, messageId: string) => Promise<boolean>;
  direct: (userId: string, message: Message) => Promise<void>;
  exists: (channelId: string, messageId: string) => Promise<boolean>;
  findOwn: (channelId: string, content: string) => Promise<string | undefined>;
  ownReactions: (channelId: string, messageId: string) => Promise<string[]>;
  react: (channelId: string, messageId: string, emoji: string) => Promise<void>;
};

export type Directory = {
  guildOf: (channelId: string) => Promise<string | undefined>;
  channels: (guildId: string) => Promise<ChannelInfo[]>;
  roles: (guildId: string) => Promise<RoleInfo[]>;
  role: (guildId: string, roleId: string) => Promise<RoleInfo | undefined>;
  member: (guildId: string, userId: string) => Promise<Actor | undefined>;
  canPost: (actor: Actor, channelId: string) => Promise<boolean>;
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
};

export type CalendarEvent = {
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
};

export type Calendar = {
  upsert: (
    guildId: string,
    id: string | null,
    event: CalendarEvent,
  ) => Promise<string>;
  remove: (guildId: string, id: string) => Promise<void>;
};
