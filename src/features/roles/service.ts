import { and, asc, count, eq, max } from 'drizzle-orm';
import type { Db } from '~/infra/db';
import { UserError } from '~/domain';
import { rolePanelRoles, rolePanels } from './schema';

export const maxPanelRoles = 25;

export type PanelRole = {
  roleId: string;
  label: string;
  emoji: string | null;
};

export type Panel = typeof rolePanels.$inferSelect & { roles: PanelRole[] };

export async function findReactionRole(
  db: Db,
  reaction: {
    guildId: string;
    channelId: string;
    messageId: string;
    emoji: string;
  },
): Promise<string | undefined> {
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
}

export async function getPanel(
  db: Db,
  guildId: string,
  panelId: number,
): Promise<Panel | undefined> {
  const [panel] = await db
    .select()
    .from(rolePanels)
    .where(and(eq(rolePanels.id, panelId), eq(rolePanels.guildId, guildId)));

  if (!panel) {
    return undefined;
  }

  const roles = await db
    .select({
      roleId: rolePanelRoles.roleId,
      label: rolePanelRoles.label,
      emoji: rolePanelRoles.emoji,
    })
    .from(rolePanelRoles)
    .where(eq(rolePanelRoles.panelId, panelId))
    .orderBy(asc(rolePanelRoles.position));

  return { ...panel, roles };
}

export async function requirePanel(
  db: Db,
  guildId: string,
  panelId: number,
): Promise<Panel> {
  const panel = await getPanel(db, guildId, panelId);

  if (!panel) {
    throw new UserError(`Role panel #${panelId} does not exist.`);
  }

  return panel;
}

export async function listPanels(db: Db, guildId: string) {
  return db
    .select({
      id: rolePanels.id,
      title: rolePanels.title,
      kind: rolePanels.kind,
      channelId: rolePanels.channelId,
    })
    .from(rolePanels)
    .where(eq(rolePanels.guildId, guildId))
    .orderBy(asc(rolePanels.id))
    .limit(100);
}

export async function listSelfAssignableRoles(
  db: Db,
  guildId: string,
): Promise<Array<{ roleId: string; panelId: number }>> {
  return db
    .selectDistinctOn([rolePanelRoles.roleId], {
      roleId: rolePanelRoles.roleId,
      panelId: rolePanelRoles.panelId,
    })
    .from(rolePanelRoles)
    .innerJoin(rolePanels, eq(rolePanels.id, rolePanelRoles.panelId))
    .where(eq(rolePanels.guildId, guildId))
    .orderBy(rolePanelRoles.roleId)
    .limit(500);
}

export async function createPanel(
  db: Db,
  input: {
    guildId: string;
    channelId: string;
    kind: 'reaction' | 'select';
    title: string;
    createdBy: string;
  },
): Promise<number> {
  const [row] = await db
    .insert(rolePanels)
    .values(input)
    .returning({ id: rolePanels.id });

  if (!row) {
    throw new Error('Insert returned no row');
  }

  return row.id;
}

export async function findReactionPanel(
  db: Db,
  guildId: string,
  channelId: string,
) {
  const [panel] = await db
    .select()
    .from(rolePanels)
    .where(
      and(
        eq(rolePanels.guildId, guildId),
        eq(rolePanels.channelId, channelId),
        eq(rolePanels.kind, 'reaction'),
      ),
    );

  return panel;
}

export async function setPanelMessage(
  db: Db,
  panelId: number,
  messageId: string | null,
): Promise<void> {
  await db
    .update(rolePanels)
    .set({ messageId })
    .where(eq(rolePanels.id, panelId));
}

export async function setPanelTitle(
  db: Db,
  panelId: number,
  title: string,
): Promise<void> {
  await db.update(rolePanels).set({ title }).where(eq(rolePanels.id, panelId));
}

export async function replacePanelRoles(
  db: Db,
  panelId: number,
  roles: readonly PanelRole[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(rolePanelRoles).where(eq(rolePanelRoles.panelId, panelId));
    if (roles.length > 0) {
      await tx
        .insert(rolePanelRoles)
        .values(
          roles.map((role, position) => ({ ...role, panelId, position })),
        );
    }
  });
}

export async function addPanelRole(
  db: Db,
  panelId: number,
  role: PanelRole,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: rolePanels.id })
      .from(rolePanels)
      .where(eq(rolePanels.id, panelId))
      .for('update');
    const [stats] = await tx
      .select({ total: count(), last: max(rolePanelRoles.position) })
      .from(rolePanelRoles)
      .where(eq(rolePanelRoles.panelId, panelId));

    if ((stats?.total ?? 0) >= maxPanelRoles) {
      throw new UserError(`A panel can hold at most ${maxPanelRoles} roles.`);
    }

    const inserted = await tx
      .insert(rolePanelRoles)
      .values({ ...role, panelId, position: (stats?.last ?? -1) + 1 })
      .onConflictDoNothing()
      .returning({ roleId: rolePanelRoles.roleId });

    if (inserted.length === 0) {
      throw new UserError('That role is already on this panel.');
    }
  });
}

export async function removePanelRole(
  db: Db,
  panelId: number,
  roleId: string,
): Promise<boolean> {
  const rows = await db
    .delete(rolePanelRoles)
    .where(
      and(
        eq(rolePanelRoles.panelId, panelId),
        eq(rolePanelRoles.roleId, roleId),
      ),
    )
    .returning({ roleId: rolePanelRoles.roleId });

  return rows.length > 0;
}

export async function deletePanel(db: Db, panelId: number): Promise<void> {
  await db.delete(rolePanels).where(eq(rolePanels.id, panelId));
}
