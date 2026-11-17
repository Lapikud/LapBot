import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';

export const rolePanelKind = pgEnum('role_panel_kind', ['reaction', 'select']);

export const rolePanels = pgTable(
  'role_panels',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').unique(),
    kind: rolePanelKind('kind').notNull(),
    title: text('title').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('role_panels_guild_idx').on(table.guildId),
    uniqueIndex('role_panels_reaction_channel_idx')
      .on(table.guildId, table.channelId)
      .where(eq(table.kind, 'reaction').inlineParams()),
  ],
);

export const rolePanelRoles = pgTable(
  'role_panel_roles',
  {
    panelId: integer('panel_id')
      .notNull()
      .references(() => rolePanels.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    label: text('label').notNull(),
    emoji: text('emoji'),
    position: integer('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.panelId, table.roleId] })],
);
