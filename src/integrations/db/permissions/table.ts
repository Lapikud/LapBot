import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    subjectType: text('subject_type')
      .$type<'role' | 'user'>()
      .notNull()
      .default('role'),
    permission: text('permission').notNull(),
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'role_permissions_subject_type_check',
      sql`${table.subjectType} IN ('role', 'user')`,
    ),
    primaryKey({
      columns: [
        table.guildId,
        table.roleId,
        table.subjectType,
        table.permission,
      ],
    }),
  ],
);
