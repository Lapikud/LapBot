import { describe, expect, it } from 'vitest';
import { createRoleService, legacyMessage } from '~/features/roles/service';
import { createRolePanelRepository } from '~/features/roles/repository';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';

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
    await service.save(admin, channelId, [{ roleId: 'helpdesk', emoji: '🎉' }]);
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
