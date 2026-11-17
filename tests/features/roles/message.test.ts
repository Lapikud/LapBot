import { expect, it, vi } from 'vitest';
import type { RolePanelRepository } from '~/features/roles/model';
import { createRoleService, legacyMessage } from '~/features/roles/service';
import {
  actor,
  fakeDirectory,
  fakeMessenger,
  role,
  silentLog,
} from '../../fakes';

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

it('saves and publishes a reaction panel for administrators', async () => {
  const { service, panels, messenger } = setup();

  await service.save(actor({ administrator: true }), 'c', [
    { roleId: 'r', emoji: '🎉' },
  ]);
  expect(panels.replaceRoles).toHaveBeenCalledWith(1, [
    { roleId: 'r', emoji: '🎉', label: 'Role' },
  ]);
  expect(messenger.react).toHaveBeenCalledWith('c', expect.any(String), '🎉');
});

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

it('does not overwrite saved choices with environment defaults on restart', async () => {
  const { panels, messenger, directory } = setup();
  const stored = { id: 1, messageId: 'existing' };

  messenger.exists.mockResolvedValue(true);

  panels.reactionPanel.mockImplementation(async () => stored);
  panels.list.mockResolvedValue([
    {
      ...stored,
      guildId: 'g',
      channelId: 'c',
      kind: 'reaction',
      title: 'Roles',
      createdBy: 'u',
      roles: [{ roleId: 'r', label: 'Saved role', emoji: '🎉' }],
    },
  ]);
  const service = createRoleService({
    panels,
    messenger,
    directory,
    log: silentLog,
    legacy: {
      channelId: 'c',
      roles: [{ roleId: 'r', emoji: '1️⃣', label: 'Legacy' }],
    },
  });

  await service.syncLegacyPanel();
  expect(panels.replaceRoles).not.toHaveBeenCalled();
  expect(messenger.send).not.toHaveBeenCalled();
  expect(messenger.react).toHaveBeenCalledWith('c', 'existing', '🎉');
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

it('assigns and removes the selected role through reactions', async () => {
  const { service, directory } = setup();
  const reaction = {
    guildId: 'g',
    channelId: 'c',
    messageId: 'm',
    emoji: '🎉',
    userId: 'member',
  };

  await service.reacted(reaction, true);
  await service.reacted(reaction, false);
  expect(directory.addRoles).toHaveBeenCalledWith(
    { guildId: 'g', userId: 'member' },
    ['r'],
    expect.any(String),
  );
  expect(directory.removeRoles).toHaveBeenCalledWith(
    { guildId: 'g', userId: 'member' },
    ['r'],
    expect.any(String),
  );
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
  expect(messenger.clearReactionsExcept).toHaveBeenCalledWith('c', 'm', ['🎉']);
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
