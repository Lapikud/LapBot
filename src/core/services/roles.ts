import { selfAssignProblem, UserError, type Actor } from '~/domain';
import type {
  Directory,
  Logger,
  Messenger,
  RolePanelRepository,
  PanelRole,
  RolePanel,
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

function panelContent(entries: readonly PanelRole[]) {
  return [
    'Valige endale rolli:',
    ...entries.map((entry) => `${entry.emoji ?? ''} - ${entry.label}`),
    '',
    'React to get a role. Remove your reaction to leave it.',
  ].join('\n');
}

export function createRoleService(deps: Deps) {
  const { panels, directory, messenger, log, legacy } = deps;

  const postLegacy = async (channelId: string, content = legacyMessage) => {
    log.info({ channelId }, 'Posting role selection message');

    const sent = await messenger.send(channelId, { content });

    return sent.messageId;
  };

  const storedRoles = async (guildId: string, panelId: number) => {
    const saved = await panels.list(guildId);

    return saved.find((stored) => stored.id === panelId)?.roles ?? [];
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

    if (!existing) {
      await panels.replaceRoles(panel.id, legacy.roles);
    }

    // Once imported, the database owns the panel configuration.
    const entries = existing
      ? await storedRoles(guildId, panel.id)
      : legacy.roles;
    const content = existing ? panelContent(entries) : legacyMessage;

    const stored =
      panel.messageId !== null &&
      (await messenger.exists(legacy.channelId, panel.messageId))
        ? panel.messageId
        : undefined;
    const located =
      stored ?? (await messenger.findOwn(legacy.channelId, content));
    const messageId = located ?? (await postLegacy(legacy.channelId, content));

    if (messageId !== panel.messageId) {
      await panels.setMessage(panel.id, messageId);
    }

    const present = new Set(
      await messenger.ownReactions(legacy.channelId, messageId),
    );
    const missing = entries.filter(
      ({ emoji }) => emoji !== null && !present.has(emoji),
    );

    await sequential(missing, ({ emoji }) =>
      messenger.react(legacy.channelId, messageId, emoji ?? ''),
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

  const requireAdmin = (actor: Actor) => {
    if (!actor.administrator) {
      throw new UserError(
        'Only server administrators can manage role selection.',
      );
    }
  };

  const list = async (actor: Actor) => {
    requireAdmin(actor);

    return panels.list(actor.guildId);
  };

  type Choice = { roleId: string; emoji: string };
  const validateChoices = async (
    guildId: string,
    choices: readonly Choice[],
  ) => {
    if (
      choices.length > 20 ||
      new Set(choices.map((c) => c.emoji)).size !== choices.length ||
      new Set(choices.map((c) => c.roleId)).size !== choices.length
    ) {
      throw new UserError(
        'Use at most 20 choices, each with a different role and emoji.',
      );
    }

    return Promise.all(
      choices.map(async (choice): Promise<PanelRole> => {
        const segments = [
          ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
            choice.emoji,
          ),
        ];

        if (
          segments.length !== 1 ||
          !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(
            choice.emoji,
          )
        ) {
          throw new UserError(
            'Use one standard emoji for each role, such as 🎉 or 1️⃣.',
          );
        }

        const role = await directory.role(guildId, choice.roleId);
        const problem = role ? selfAssignProblem(role) : 'does not exist';

        if (!role || problem !== undefined) {
          throw new UserError(`That role ${problem ?? 'is unavailable'}.`);
        }

        return { ...choice, label: role.name };
      }),
    );
  };

  const publishPanel = async (
    actor: Actor,
    channelId: string,
    entries: PanelRole[],
    existing: RolePanel | undefined,
  ) => {
    for (const entry of entries) {
      if (
        existing?.roles.some(
          (old) => old.emoji === entry.emoji && old.roleId !== entry.roleId,
        ) === true
      ) {
        throw new UserError(
          'Use a new emoji when changing the role assigned to a reaction.',
        );
      }
    }

    const content = panelContent(entries);

    if (content.length > 2000) {
      throw new UserError('The panel is too long. Choose fewer roles.');
    }

    const id =
      existing?.id ??
      (await panels.create({
        guildId: actor.guildId,
        channelId,
        kind: 'reaction',
        title: 'Role selection',
        createdBy: actor.userId,
      }));
    let messageId = existing?.messageId ?? null;

    if (messageId !== null) {
      await messenger.clearReactionsExcept(
        channelId,
        messageId,
        entries.map((entry) => entry.emoji ?? ''),
      );
    }

    if (
      messageId === null ||
      !(await messenger.edit(channelId, messageId, { content }))
    ) {
      const sent = await messenger.send(channelId, { content });

      messageId = sent.messageId;
      await panels.setMessage(id, messageId);
    }

    await panels.replaceRoles(id, entries);
    const present = new Set(await messenger.ownReactions(channelId, messageId));
    const missing = entries.filter(
      (entry) => entry.emoji !== null && !present.has(entry.emoji),
    );
    const target = messageId;

    await sequential(missing, (entry) =>
      messenger.react(channelId, target, entry.emoji ?? ''),
    );
  };

  const saving = new Set<string>();
  const save = async (
    actor: Actor,
    channelId: string,
    choices: readonly Choice[],
  ) => {
    requireAdmin(actor);
    if (
      (await directory.guildOf(channelId)) !== actor.guildId ||
      !(await directory.canView(actor, channelId)) ||
      !(await directory.canPost(actor, channelId))
    ) {
      throw new UserError(
        'Choose a server channel where you and the bot can post.',
      );
    }

    const entries = await validateChoices(actor.guildId, choices);

    if (saving.has(channelId)) {
      throw new UserError('This panel is being saved. Please try again.');
    }

    saving.add(channelId);
    try {
      const stored = await panels.list(actor.guildId);
      const existing = stored.find((p) => p.channelId === channelId);

      await publishPanel(actor, channelId, entries, existing);
      log.info(
        { guildId: actor.guildId, channelId, actorId: actor.userId },
        'Role selection saved',
      );
    } finally {
      saving.delete(channelId);
    }
  };

  return { syncLegacyPanel, reacted, list, save };
}

export type RoleService = ReturnType<typeof createRoleService>;
