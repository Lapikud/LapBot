import { and, asc, eq } from 'drizzle-orm';
import type { RolePanelRepository } from '~/features/roles/model';
import type { Db } from '../client';
import { rolePanelRoles, rolePanels } from './table';

export function createRolePanelRepository(db: Db): RolePanelRepository {
  return {
    list: async (guildId) => {
      const panels = await db
        .select()
        .from(rolePanels)
        .where(
          and(eq(rolePanels.guildId, guildId), eq(rolePanels.kind, 'reaction')),
        )
        .orderBy(asc(rolePanels.id));

      return Promise.all(
        panels.map(async (panel) => ({
          ...panel,
          roles: await db
            .select({
              roleId: rolePanelRoles.roleId,
              label: rolePanelRoles.label,
              emoji: rolePanelRoles.emoji,
            })
            .from(rolePanelRoles)
            .where(eq(rolePanelRoles.panelId, panel.id))
            .orderBy(asc(rolePanelRoles.position)),
        })),
      );
    },
    reactionRole: async (reaction) => {
      const [row] = await db
        .select({ roleId: rolePanelRoles.roleId })
        .from(rolePanels)
        .innerJoin(rolePanelRoles, eq(rolePanelRoles.panelId, rolePanels.id))
        .where(
          and(
            eq(rolePanels.messageId, reaction.messageId),
            eq(rolePanels.guildId, reaction.guildId),
            eq(rolePanels.channelId, reaction.channelId),
            eq(rolePanels.kind, 'reaction'),
            eq(rolePanelRoles.emoji, reaction.emoji),
          ),
        )
        .limit(1);

      return row?.roleId;
    },
    create: async (input) => {
      const [row] = await db
        .insert(rolePanels)
        .values(input)
        .returning({ id: rolePanels.id });

      if (!row) {
        throw new Error('Insert returned no row');
      }

      return row.id;
    },
    setMessage: async (panelId, messageId) => {
      await db
        .update(rolePanels)
        .set({ messageId })
        .where(eq(rolePanels.id, panelId));
    },
    remove: async (panelId) => {
      await db.delete(rolePanels).where(eq(rolePanels.id, panelId));
    },
    replaceRoles: async (panelId, roles) => {
      await db.transaction(async (tx) => {
        await tx
          .delete(rolePanelRoles)
          .where(eq(rolePanelRoles.panelId, panelId));
        if (roles.length > 0) {
          await tx
            .insert(rolePanelRoles)
            .values(
              roles.map((role, position) => ({ ...role, panelId, position })),
            );
        }
      });
    },
  };
}
