import {
  channelMention,
  controlId,
  requireAbove,
  requireManageable,
  requireSelfAssignable,
  roleMention,
  selfAssignProblem,
  UserError,
  type Actor,
  type Message,
  type RoleInfo,
} from '~/domain';
import type {
  Authorizer,
  Directory,
  Logger,
  Messenger,
  NewRole,
  PanelRole,
  RolePanel,
  RolePanelRepository,
} from '~/core/ports';
import { sequential } from '~/lib';
import { guard } from './guard';

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
  authz: Authorizer;
  log: Logger;
  legacy?: LegacyPanel | undefined;
};

export function panelView(panel: RolePanel): Message {
  return {
    embeds: [
      {
        title: panel.title,
        description:
          panel.roles.length === 0
            ? 'No roles yet.'
            : panel.roles
                .map((role) => `• ${roleMention(role.roleId)}`)
                .join('\n'),
      },
    ],
    controls:
      panel.roles.length === 0
        ? []
        : [
            [
              {
                kind: 'button',
                id: controlId('roles:open', panel.id),
                label: 'Choose roles',
                style: 'primary',
              },
            ],
          ],
  };
}

export function choiceView(actor: Actor, panel: RolePanel): Message {
  return {
    content:
      'Pick the roles you want. Unselected roles from this panel are removed.',
    controls: [
      [
        {
          kind: 'select',
          id: controlId('roles:choose', panel.id),
          placeholder: 'Select your roles',
          min: 0,
          max: panel.roles.length,
          options: panel.roles.map((role) => ({
            label: role.label,
            value: role.roleId,
            default: actor.roleIds.includes(role.roleId),
          })),
        },
      ],
    ],
  };
}

export function createRoleService(deps: Deps) {
  const { panels, directory, messenger, authz, log, legacy } = deps;

  const requirePanel = async (guildId: string, id: number) => {
    const panel = await panels.find(guildId, id);

    if (!panel) {
      throw new UserError(`Role panel #${id} does not exist.`);
    }

    return panel;
  };

  const requireRole = async (guildId: string, roleId: string) => {
    const role = await directory.role(guildId, roleId);

    if (!role) {
      throw new UserError('That role no longer exists.');
    }

    return role;
  };

  const publish = async (panel: RolePanel) => {
    const view = panelView(panel);
    const edited =
      panel.messageId !== null &&
      (await messenger.edit(panel.channelId, panel.messageId, view));

    if (!edited) {
      const sent = await messenger.send(panel.channelId, view);

      await panels.setMessage(panel.id, sent.messageId);
    }
  };

  const assignable = (actor: Actor, role: RoleInfo) => {
    requireAbove(actor, role);
    requireManageable(role);

    if (role.administrator && !actor.administrator) {
      throw new UserError(
        'Only administrators can hand out administrator roles.',
      );
    }
  };

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

  return {
    syncLegacyPanel,
    reacted,
    panels: (guildId: string) => panels.list(guildId),
    overview: async (guildId: string) => ({
      roles: await panels.selfAssignable(guildId),
      panels: await panels.list(guildId),
    }),
    open: async (actor: Actor, panelId: number) => {
      const panel = await requirePanel(actor.guildId, panelId);

      if (panel.roles.length === 0) {
        throw new UserError('This panel has no roles yet.');
      }

      return choiceView(actor, panel);
    },
    choose: async (
      actor: Actor,
      panelId: number,
      wanted: readonly string[],
    ) => {
      const panel = await requirePanel(actor.guildId, panelId);
      const selected = new Set(wanted);
      const roles = await directory.roles(actor.guildId);
      const byId = new Map(roles.map((role) => [role.id, role]));
      const usable = panel.roles.filter((entry) => {
        const role = byId.get(entry.roleId);

        return role !== undefined && selfAssignProblem(role) === undefined;
      });
      const skipped = panel.roles.filter((entry) => !usable.includes(entry));
      const has = (roleId: string) => actor.roleIds.includes(roleId);
      const toAdd = usable
        .filter((entry) => selected.has(entry.roleId) && !has(entry.roleId))
        .map((entry) => entry.roleId);
      const toRemove = usable
        .filter((entry) => !selected.has(entry.roleId) && has(entry.roleId))
        .map((entry) => entry.roleId);
      const member = { guildId: actor.guildId, userId: actor.userId };

      if (toAdd.length > 0) {
        await directory.addRoles(member, toAdd, 'Role panel selection');
      }

      if (toRemove.length > 0) {
        await directory.removeRoles(member, toRemove, 'Role panel selection');
      }

      log.info({ ...member, toAdd, toRemove }, 'Updated roles from panel');

      return {
        changed: toAdd.length + toRemove.length,
        skipped: skipped.map((s) => s.label),
      };
    },
    createPanel: guard(
      authz,
      'role:manage',
      async (actor, channelId: string, title: string) => {
        if (!(await directory.canPost(actor, channelId))) {
          throw new UserError(
            `You cannot post in ${channelMention(channelId)} yourself.`,
          );
        }

        const id = await panels.create({
          guildId: actor.guildId,
          channelId,
          kind: 'select',
          title,
          createdBy: actor.userId,
        });

        await publish(await requirePanel(actor.guildId, id));

        return id;
      },
    ),
    updatePanel: guard(
      authz,
      'role:manage',
      async (
        actor,
        panelId: number,
        changes: { add?: PanelRole; remove?: string; title?: string },
      ) => {
        const panel = await requirePanel(actor.guildId, panelId);

        if (panel.kind === 'reaction') {
          throw new UserError(
            'The legacy reaction panel is configured through environment variables.',
          );
        }

        if (changes.add) {
          const role = await requireRole(actor.guildId, changes.add.roleId);

          requireSelfAssignable(role);
          requireAbove(actor, role);
          await panels.addRole(panel.id, changes.add);
        }

        if (
          changes.remove !== undefined &&
          !(await panels.removeRole(panel.id, changes.remove))
        ) {
          throw new UserError('That role is not on this panel.');
        }

        if (changes.title !== undefined) {
          await panels.setTitle(panel.id, changes.title);
        }

        await publish(await requirePanel(actor.guildId, panel.id));
      },
    ),
    removePanel: guard(authz, 'role:manage', async (actor, panelId: number) => {
      const panel = await requirePanel(actor.guildId, panelId);

      if (panel.kind === 'reaction' && !actor.administrator) {
        throw new UserError(
          'Only an administrator can remove the original role message.',
        );
      }

      if (panel.messageId !== null) {
        await messenger.remove(panel.channelId, panel.messageId);
      }

      await panels.remove(panel.id);
      log.info(
        { panelId, actorId: actor.userId, kind: panel.kind },
        'Role panel removed',
      );

      return panel;
    }),
    createRole: guard(authz, 'role:create', (actor, role: NewRole) =>
      directory.createRole(actor.guildId, role, `Requested by ${actor.userId}`),
    ),
    deleteRole: guard(authz, 'role:manage', async (actor, roleId: string) => {
      const role = await requireRole(actor.guildId, roleId);

      requireAbove(actor, role);
      requireManageable(role);
      await directory.deleteRole(
        actor.guildId,
        roleId,
        `Requested by ${actor.userId}`,
      );

      return role;
    }),
    assign: guard(
      authz,
      'role:assign',
      async (actor, userId: string, roleId: string) => {
        assignable(actor, await requireRole(actor.guildId, roleId));
        await directory.addRoles(
          { guildId: actor.guildId, userId },
          [roleId],
          `Assigned by ${actor.userId}`,
        );
      },
    ),
    unassign: guard(
      authz,
      'role:assign',
      async (actor, userId: string, roleId: string) => {
        assignable(actor, await requireRole(actor.guildId, roleId));
        await directory.removeRoles(
          { guildId: actor.guildId, userId },
          [roleId],
          `Removed by ${actor.userId}`,
        );
      },
    ),
  };
}

export type RoleService = ReturnType<typeof createRoleService>;
