import { describe, expect, it, vi } from 'vitest';
import { createRoleService } from '~/features/roles/service';
import { createRolePanelRepository } from '~/integrations/db/roles/repository';
import { noDatabase, snowflake, testDb } from './db';
import { actor, fakeDirectory, fakeMessenger, role, silentLog } from './fakes';
import type { RolePanelRepository } from '~/features/roles/model';
import type { Client } from 'discord.js';
import { createDiscordMessenger } from '~/integrations/discord/messenger';

describe('role service', () => {
  describe.skipIf(noDatabase)('role service', () => {
    const setup = async (
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
      });
      const admin = actor({ guildId, administrator: true });

      await service.save(admin, channelId, [
        { roleId: 'tarkvara', emoji: '1️⃣' },
        { roleId: 'helpdesk', emoji: '2️⃣' },
      ]);

      return { guildId, channelId, messenger, directory, service, sent, admin };
    };

    it('keeps the panel message across restarts and reposts it when deleted', async () => {
      const { service, messenger, guildId } = await setup();

      messenger.exists.mockResolvedValue(true);
      messenger.ownReactions.mockResolvedValue(['1️⃣', '2️⃣']);
      await service.syncPanels(guildId);
      expect(messenger.send).toHaveBeenCalledOnce();

      messenger.exists.mockResolvedValue(false);
      messenger.ownReactions.mockResolvedValue([]);
      await service.syncPanels(guildId);
      expect(messenger.send).toHaveBeenCalledTimes(2);
      expect(messenger.react).toHaveBeenCalledTimes(4);
    });

    it('assigns and removes mapped roles, ignoring other messages and emoji', async () => {
      const { service, sent, directory, guildId, channelId } = await setup();
      const reaction = {
        guildId,
        channelId,
        messageId: sent[0] ?? '',
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

    it('deletes the panel and its message', async () => {
      const { service, messenger, sent, admin, channelId, guildId } =
        await setup();

      await expect(
        service.remove(actor({ guildId }), channelId),
      ).rejects.toThrow('Only server administrators');
      await service.remove(admin, channelId);
      expect(messenger.remove).toHaveBeenCalledWith(channelId, sent[0]);
      await expect(service.list(admin)).resolves.toEqual([]);
    });

    it('skips roles that are no longer assignable', async () => {
      const { service, sent, directory, guildId, channelId } = await setup();

      directory.role.mockResolvedValue(
        role({ id: 'tarkvara', moderator: true }),
      );
      await service.reacted(
        {
          guildId,
          channelId,
          messageId: sent[0] ?? '',
          emoji: '1️⃣',
          userId: 'u',
        },
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
      create: vi.fn(async () => 1),
      replaceRoles: vi.fn(async () => undefined),
      setMessage: vi.fn(async () => undefined),
      reactionRole: vi.fn(async () => 'r'),
      remove: vi.fn(async () => undefined),
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

    await expect(service.save(actor(), 'c', [])).rejects.toThrow(
      'Only server administrators',
    );
    directory.role.mockResolvedValue(role({ moderator: true }));
    await expect(
      service.save(actor({ administrator: true }), 'c', [
        { roleId: 'r', emoji: '🎉' },
      ]),
    ).rejects.toThrow('moderator');
    expect(panels.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate emojis before writing', async () => {
    const { service, panels } = setup();

    await expect(
      service.save(actor({ administrator: true }), 'c', [
        { roleId: 'r', emoji: '🎉' },
        { roleId: 'x', emoji: '🎉' },
      ]),
    ).rejects.toThrow('different role and emoji');
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
    ).rejects.toThrow('Choose a server channel');
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

  it('adds only missing reactions to a stored panel on startup', async () => {
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
        roles: [
          { roleId: 'r', label: 'Role', emoji: '1️⃣' },
          { roleId: 'x', label: 'Other', emoji: '2️⃣' },
        ],
      },
    ]);
    messenger.exists.mockResolvedValue(true);
    messenger.ownReactions.mockResolvedValue(['1️⃣']);
    await service.syncPanels('g');
    expect(messenger.send).not.toHaveBeenCalled();
    expect(messenger.react).toHaveBeenCalledExactlyOnceWith('c', 'm', '2️⃣');
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
