import { describe, expect, it, vi } from 'vitest';
import { createRoleService, legacyMessage } from '~/features/roles/service';
import { createRolePanelRepository } from '~/integrations/db/roles/repository';
import { noDatabase, snowflake, testDb } from './db';
import { actor, fakeDirectory, fakeMessenger, role, silentLog } from './fakes';
import type { RolePanelRepository } from '~/features/roles/model';
import type { Client } from 'discord.js';
import { createDiscordMessenger } from '~/integrations/discord/messenger';

describe('role service', () => {
  describe.skipIf(noDatabase)('role service', () => {
    const setup = (
      roles = [role({ id: 'tarkvara' }), role({ id: 'helpdesk' })],
    ) => {
      const guildId = snowflake();
      const channelId = snowflake();
      const { messenger, sent } = fakeMessenger();
      const directory = fakeDirectory(roles, { guildId });
      const service = createRoleService({
        panels: createRolePanelRepository(testDb()),
        directory,
        messenger,
        log: silentLog,
        legacy: {
          channelId,
          roles: [
            { emoji: '1️⃣', roleId: 'tarkvara', label: 'Tarkvara' },
            { emoji: '2️⃣', roleId: 'helpdesk', label: 'Helpdesk' },
          ],
        },
      });

      return { guildId, channelId, messenger, directory, service, sent };
    };

    it('posts the legacy message once and reuses it after restarts', async () => {
      const { service, messenger } = setup();

      await service.syncLegacyPanel();
      await service.syncLegacyPanel();

      expect(messenger.send).toHaveBeenCalledOnce();
      expect(messenger.send).toHaveBeenCalledWith(expect.any(String), {
        content: legacyMessage,
      });
      expect(messenger.react).toHaveBeenCalledTimes(4);
    });

    it('assigns and removes mapped roles, ignoring other messages and emoji', async () => {
      const { service, sent, directory, guildId, channelId } = setup();

      await service.syncLegacyPanel();

      const messageId = sent[0] ?? '';
      const reaction = {
        guildId,
        channelId,
        messageId,
        emoji: '1️⃣',
        userId: 'member',
      };

      await service.reacted(reaction, true);
      await service.reacted(reaction, false);
      await service.reacted({ ...reaction, messageId: 'other' }, true);
      await service.reacted({ ...reaction, emoji: '🎉' }, true);

      expect(directory.addRoles).toHaveBeenCalledExactlyOnceWith(
        { guildId, userId: 'member' },
        ['tarkvara'],
        expect.any(String),
      );
      expect(directory.removeRoles).toHaveBeenCalledOnce();
    });

    it('persists web choices and keeps them after legacy startup sync', async () => {
      const { service, guildId, channelId, sent, directory } = setup();
      const admin = actor({ guildId, administrator: true });

      await service.syncLegacyPanel();
      await service.save(admin, channelId, [
        { roleId: 'helpdesk', emoji: '🎉' },
      ]);
      await service.syncLegacyPanel();

      const panels = await service.list(admin);

      expect(panels[0]?.roles).toEqual([
        { roleId: 'helpdesk', label: 'Role', emoji: '🎉' },
      ]);
      expect(sent).toHaveLength(1);
      await service.reacted(
        {
          guildId,
          channelId,
          messageId: sent[0] ?? '',
          emoji: '🎉',
          userId: 'member',
        },
        true,
      );
      expect(directory.addRoles).toHaveBeenCalledWith(
        { guildId, userId: 'member' },
        ['helpdesk'],
        expect.any(String),
      );
    });

    it('skips roles that are gone or no longer assignable', async () => {
      const { service, sent, directory, guildId, channelId } = setup([
        role({ id: 'tarkvara', moderator: true }),
      ]);

      await service.syncLegacyPanel();

      const messageId = sent[0] ?? '';

      await service.reacted(
        { guildId, channelId, messageId, emoji: '1️⃣', userId: 'u' },
        true,
      );
      await service.reacted(
        { guildId, channelId, messageId, emoji: '2️⃣', userId: 'u' },
        true,
      );
      expect(directory.addRoles).not.toHaveBeenCalled();
    });
  });
});

describe('role message configuration', () => {
  function setup() {
    const panels = {
      list: vi.fn<RolePanelRepository['list']>(async () => []),
      reactionPanel: vi.fn<RolePanelRepository['reactionPanel']>(
        async () => undefined,
      ),
      create: vi.fn(async () => 1),
      replaceRoles: vi.fn(async () => undefined),
      setMessage: vi.fn(async () => undefined),
      reactionRole: vi.fn(async () => 'r'),
    } satisfies RolePanelRepository;
    const { messenger } = fakeMessenger();
    const directory = fakeDirectory([role()]);
    const service = createRoleService({
      panels,
      messenger,
      directory,
      log: silentLog,
    });

    return { service, panels, messenger, directory };
  }

  it('rejects unauthorized configuration and unsafe roles before writing', async () => {
    const { service, panels, directory } = setup();

    await expect(service.save(actor(), 'c', [])).rejects.toThrow();
    directory.role.mockResolvedValue(role({ moderator: true }));
    await expect(
      service.save(actor({ administrator: true }), 'c', [
        { roleId: 'r', emoji: '🎉' },
      ]),
    ).rejects.toThrow();
    expect(panels.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate emojis before writing', async () => {
    const { service, panels } = setup();

    await expect(
      service.save(actor({ administrator: true }), 'c', [
        { roleId: 'r', emoji: '🎉' },
        { roleId: 'x', emoji: '🎉' },
      ]),
    ).rejects.toThrow();
    expect(panels.create).not.toHaveBeenCalled();
  });

  it('updates the existing panel and keeps the same Discord message', async () => {
    const { panels, messenger, service } = setup();

    panels.list.mockImplementation(async () => [
      {
        id: 1,
        guildId: 'g',
        channelId: 'c',
        messageId: 'm',
        kind: 'reaction' as const,
        title: 'Roles',
        createdBy: 'u',
        roles: [],
      },
    ]);
    messenger.edit.mockResolvedValue(true);
    await service.save(actor({ administrator: true }), 'c', [
      { roleId: 'r', emoji: '🎉' },
    ]);
    expect(messenger.edit.mock.calls[0]?.[2].content).toContain('🎉 - Role');
    expect(messenger.send).not.toHaveBeenCalled();
    expect(panels.create).not.toHaveBeenCalled();
  });

  it('rejects a channel from another guild before writing', async () => {
    const { service, panels, directory } = setup();

    directory.guildOf.mockResolvedValue('other');
    await expect(
      service.save(actor({ administrator: true }), 'c', [
        { roleId: 'r', emoji: '🎉' },
      ]),
    ).rejects.toThrow();
    expect(panels.create).not.toHaveBeenCalled();
  });

  it('rejects reassigning an existing reaction to another role', async () => {
    const { service, panels, messenger } = setup();

    panels.list.mockResolvedValue([
      {
        id: 1,
        guildId: 'g',
        channelId: 'c',
        messageId: 'm',
        kind: 'reaction',
        title: 'Roles',
        createdBy: 'u',
        roles: [{ roleId: 'old', label: 'Old role', emoji: '🎉' }],
      },
    ]);
    await expect(
      service.save(actor({ administrator: true }), 'c', [
        { roleId: 'r', emoji: '🎉' },
      ]),
    ).rejects.toThrow('new emoji');
    expect(panels.replaceRoles).not.toHaveBeenCalled();
    expect(messenger.edit).not.toHaveBeenCalled();
  });

  it('clears obsolete reactions before replacing choices on an existing panel', async () => {
    const { service, panels, messenger } = setup();

    panels.list.mockResolvedValue([
      {
        id: 1,
        guildId: 'g',
        channelId: 'c',
        messageId: 'm',
        kind: 'reaction',
        title: 'Roles',
        createdBy: 'u',
        roles: [{ roleId: 'r', label: 'Role', emoji: '1️⃣' }],
      },
    ]);
    messenger.exists.mockResolvedValue(true);
    messenger.edit.mockResolvedValue(true);
    await service.save(actor({ administrator: true }), 'c', [
      { roleId: 'r', emoji: '🎉' },
    ]);
    expect(messenger.clearReactionsExcept).toHaveBeenCalledWith('c', 'm', [
      '🎉',
    ]);
    expect(
      messenger.clearReactionsExcept.mock.invocationCallOrder[0],
    ).toBeLessThan(panels.replaceRoles.mock.invocationCallOrder[0] ?? 0);
  });

  it('imports the original role message without replacing its reactions', async () => {
    const { panels, messenger, directory } = setup();
    const roles = [
      { emoji: '1️⃣', roleId: 'tarkvara', label: 'Tarkvara' },
      { emoji: '2️⃣', roleId: 'helpdesk', label: 'Helpdesk' },
      { emoji: '3️⃣', roleId: 'kultuur', label: 'Kultuur' },
    ];

    messenger.findOwn.mockResolvedValue('original-message');
    messenger.ownReactions.mockResolvedValue(roles.map(({ emoji }) => emoji));
    const service = createRoleService({
      panels,
      messenger,
      directory,
      log: silentLog,
      legacy: { channelId: 'c', roles },
    });

    await service.syncLegacyPanel();

    expect(messenger.findOwn).toHaveBeenCalledWith('c', legacyMessage);
    expect(panels.setMessage).toHaveBeenCalledWith(1, 'original-message');
    expect(panels.replaceRoles).toHaveBeenCalledWith(1, roles);
    expect(messenger.send).not.toHaveBeenCalled();
    expect(messenger.edit).not.toHaveBeenCalled();
    expect(messenger.react).not.toHaveBeenCalled();
    expect(messenger.clearReactionsExcept).not.toHaveBeenCalled();
  });
});

describe('role message reactions', () => {
  function setup() {
    const obsolete = vi.fn(async () => undefined);
    const keep = vi.fn(async () => undefined);
    const channel = {
      isTextBased: () => true,
      isDMBased: () => false,
      guild: { members: { fetchMe: async () => ({}) } },
      permissionsFor: () => ({ has: () => true }),
      messages: {
        fetch: async () => ({
          reactions: {
            cache: new Map([
              ['old', { emoji: { name: '1️⃣' }, remove: obsolete }],
              ['keep', { emoji: { name: '🎉' }, remove: keep }],
            ]),
          },
        }),
      },
    };
    const client = {
      channels: { fetch: async () => channel },
    } as unknown as Client;

    return { messenger: createDiscordMessenger(client), obsolete, keep };
  }

  it('clears obsolete member reactions and keeps configured choices', async () => {
    const { messenger, obsolete, keep } = setup();

    await messenger.clearReactionsExcept('c', 'm', ['🎉']);
    expect(obsolete).toHaveBeenCalledOnce();
    expect(keep).not.toHaveBeenCalled();
  });
});
