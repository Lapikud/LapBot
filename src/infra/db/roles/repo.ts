import { and, eq } from 'drizzle-orm';
import type { PanelRole, RolePanelRepository } from '~/core/ports';
import type { Db } from '../client';
import { rolePanelRoles, rolePanels } from './model';

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

export function createRolePanelRepository(db: Db): RolePanelRepository {
  return {
    reactionRole: (key) => findReactionRole(db, key),
    create: (panel) => createPanel(db, panel),
    reactionPanel: (guildId, channelId) =>
      findReactionPanel(db, guildId, channelId),
    setMessage: (id, messageId) => setPanelMessage(db, id, messageId),
    replaceRoles: (id, roles) => replacePanelRoles(db, id, roles),
  };
}
