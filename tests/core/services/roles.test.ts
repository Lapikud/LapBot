import { describe, expect, it } from 'vitest';
import { createRoleService, legacyMessage } from '~/core/services';
import { createRolePanelRepository } from '~/infra/db';
import { noDatabase, snowflake, testDb } from '../../db';
import {
  actor,
  allowAll,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';

describe.skipIf(noDatabase)('role service', () => {
  const setup = (
    roles = [role({ id: 'tarkvara' }), role({ id: 'helpdesk' })],
    canPost = true,
  ) => {
    const guildId = snowflake();
    const channelId = snowflake();
    const { messenger, sent } = fakeMessenger();
    const directory = fakeDirectory(roles, { canPost, guildId });
    const service = createRoleService({
      panels: createRolePanelRepository(testDb()),
      directory,
      messenger,
      authz: allowAll,
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

  it('only lets administrators remove the legacy panel', async () => {
    const { service, guildId } = setup();

    await service.syncLegacyPanel();

    const [legacy] = await service.panels(guildId);

    await expect(
      service.removePanel(actor({ guildId }), legacy?.id ?? 0),
    ).rejects.toThrow('administrator');
    await expect(
      service.removePanel(
        actor({ guildId, administrator: true }),
        legacy?.id ?? 0,
      ),
    ).resolves.toBeDefined();
  });

  it('applies select-menu choices and ignores forged role IDs', async () => {
    const { service, directory, guildId, channelId } = setup();
    const id = await service.createPanel(
      actor({ guildId }),
      channelId,
      'Teams',
    );

    await service.updatePanel(actor({ guildId }), id, {
      add: { roleId: 'tarkvara', label: 'Tarkvara', emoji: null },
    });
    await service.updatePanel(actor({ guildId }), id, {
      add: { roleId: 'helpdesk', label: 'Helpdesk', emoji: null },
    });

    const member = actor({ guildId, roleIds: ['helpdesk'] });
    const result = await service.choose(member, id, ['tarkvara', 'admin']);

    expect(result.changed).toBe(2);
    expect(directory.addRoles).toHaveBeenCalledWith(
      expect.anything(),
      ['tarkvara'],
      expect.any(String),
    );
    expect(directory.removeRoles).toHaveBeenCalledWith(
      expect.anything(),
      ['helpdesk'],
      expect.any(String),
    );
  });

  it('refuses panels in channels the member cannot post in', async () => {
    const { service, guildId, channelId } = setup(undefined, false);

    await expect(
      service.createPanel(actor({ guildId }), channelId, 'x'),
    ).rejects.toThrow('cannot post');
  });
});
