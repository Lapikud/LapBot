import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { vi } from 'vitest';
import type { Directory, Messenger } from '~/core/ports';
import { UserError, type Actor } from '~/domain';
import { type RoleInfo } from '~/domain/roles';

export const silentLog = pino({ level: 'silent' });

export function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    guildId: 'g',
    userId: 'u',
    roleIds: [],
    administrator: false,
    owner: false,
    mentionEveryone: false,
    highestRolePosition: 10,
    ...overrides,
  };
}

export function role(overrides: Partial<RoleInfo> = {}): RoleInfo {
  return {
    id: 'r',
    name: 'Role',
    position: 1,
    everyone: false,
    managed: false,
    mentionable: true,
    moderator: false,
    administrator: false,
    botCanAssign: true,
    ...overrides,
  };
}

export const allowAll = {
  can: async () => true,
  require: async () => undefined,
};

export const denyAll = {
  can: async () => false,
  require: async () => {
    throw new UserError('denied');
  },
};

export function fakeMessenger() {
  const sent: string[] = [];
  const messages = new Map<string, { channelId: string; content: string }>();
  const messenger = {
    send: vi.fn<Messenger['send']>(async (channelId, message) => {
      const messageId = randomUUID();

      sent.push(messageId);

      messages.set(messageId, { channelId, content: message.content ?? '' });

      return { channelId, messageId };
    }),
    edit: vi.fn<Messenger['edit']>(async (_c, messageId) =>
      messages.has(messageId),
    ),
    remove: vi.fn<Messenger['remove']>(async (_c, messageId) =>
      messages.delete(messageId),
    ),
    direct: vi.fn<Messenger['direct']>(async () => undefined),
    exists: vi.fn<Messenger['exists']>(async (_c, messageId) =>
      messages.has(messageId),
    ),
    findOwn: vi.fn<Messenger['findOwn']>(
      async (channelId, content) =>
        [...messages].find(
          ([, m]) => m.channelId === channelId && m.content === content,
        )?.[0],
    ),
    clearReactionsExcept: vi.fn<Messenger['clearReactionsExcept']>(
      async () => undefined,
    ),
    ownReactions: vi.fn<Messenger['ownReactions']>(async () => []),
    react: vi.fn<Messenger['react']>(async () => undefined),
  } satisfies Messenger;

  return { messenger, messages, sent };
}

export function fakeDirectory(
  roles: RoleInfo[] = [],
  options: { canPost?: boolean; guildId?: string } = {},
) {
  const directory = {
    guildOf: vi.fn<Directory['guildOf']>(async () => options.guildId ?? 'g'),
    channels: vi.fn<Directory['channels']>(async () => []),
    roles: vi.fn<Directory['roles']>(async () => roles),
    role: vi.fn<Directory['role']>(async (_g, id) =>
      roles.find((r) => r.id === id),
    ),
    member: vi.fn<Directory['member']>(async () => undefined),
    displayName: vi.fn<Directory['displayName']>(async () => undefined),
    canView: vi.fn<Directory['canView']>(async () => true),
    canPost: vi.fn<Directory['canPost']>(async () => options.canPost ?? true),
    addRoles: vi.fn<Directory['addRoles']>(async () => undefined),
    removeRoles: vi.fn<Directory['removeRoles']>(async () => undefined),
  } satisfies Directory;

  return directory;
}
