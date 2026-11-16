import { selfAssignProblem } from '~/domain';
import type {
  Directory,
  Logger,
  Messenger,
  RolePanelRepository,
} from '~/core/ports';
import { sequential } from '~/lib';

export const legacyMessage =
  'Valige endale rolli:\n1 - Tarkvara\n2 - Helpdesk\n3 - Kultuur';

export type LegacyPanel = {
  channelId: string;
  roles: ReadonlyArray<{ emoji: string; roleId: string; label: string }>;
};

export type Reaction = {
  guildId: string;
  channelId: string;
  messageId: string;
  emoji: string;
  userId: string;
};

type Deps = {
  panels: RolePanelRepository;
  directory: Directory;
  messenger: Messenger;
  log: Logger;
  legacy?: LegacyPanel | undefined;
};

export function createRoleService(deps: Deps) {
  const { panels, directory, messenger, log, legacy } = deps;

  const postLegacy = async (channelId: string) => {
    log.info({ channelId }, 'Posting role selection message');

    const sent = await messenger.send(channelId, { content: legacyMessage });

    return sent.messageId;
  };

  const syncLegacyPanel = async () => {
    if (!legacy) {
      return;
    }

    const guildId = await directory.guildOf(legacy.channelId);

    if (guildId === undefined) {
      log.error(
        { channelId: legacy.channelId },
        'ROLE_SELECTION_CHANNEL_ID is not a server text channel',
      );

      return;
    }

    const roles = await Promise.all(
      legacy.roles.map(async (entry) => ({
        entry,
        role: await directory.role(guildId, entry.roleId),
      })),
    );

    for (const { entry, role } of roles) {
      const problem = role ? selfAssignProblem(role) : 'does not exist';

      if (problem !== undefined) {
        log.error({ ...entry, problem }, 'Legacy panel role is not assignable');
      }
    }

    const existing = await panels.reactionPanel(guildId, legacy.channelId);
    const panel = existing ?? {
      id: await panels.create({
        guildId,
        channelId: legacy.channelId,
        kind: 'reaction',
        title: 'Role selection',
        createdBy: 'bot',
      }),
      messageId: null,
    };

    await panels.replaceRoles(panel.id, legacy.roles);

    const stored =
      panel.messageId !== null &&
      (await messenger.exists(legacy.channelId, panel.messageId))
        ? panel.messageId
        : undefined;
    const located =
      stored ?? (await messenger.findOwn(legacy.channelId, legacyMessage));
    const messageId = located ?? (await postLegacy(legacy.channelId));

    if (messageId !== panel.messageId) {
      await panels.setMessage(panel.id, messageId);
    }

    const present = new Set(
      await messenger.ownReactions(legacy.channelId, messageId),
    );
    const missing = legacy.roles.filter(({ emoji }) => !present.has(emoji));

    await sequential(missing, ({ emoji }) =>
      messenger.react(legacy.channelId, messageId, emoji),
    );
  };

  const reacted = async (reaction: Reaction, added: boolean) => {
    const roleId = await panels.reactionRole(reaction);

    if (roleId === undefined) {
      return;
    }

    const role = await directory.role(reaction.guildId, roleId);
    const problem = role ? selfAssignProblem(role) : 'does not exist';

    if (problem !== undefined) {
      log.warn({ roleId, problem }, 'Skipping reaction role change');

      return;
    }

    const member = { guildId: reaction.guildId, userId: reaction.userId };

    await (added
      ? directory.addRoles(member, [roleId], 'Role selection reaction')
      : directory.removeRoles(
          member,
          [roleId],
          'Role selection reaction removed',
        ));
    log.info(
      { ...member, roleId, added },
      added ? 'Assigned role' : 'Removed role',
    );
  };

  return { syncLegacyPanel, reacted };
}

export type RoleService = ReturnType<typeof createRoleService>;
