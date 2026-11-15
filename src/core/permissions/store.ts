import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '~/db/client';
import { rolePermissions } from './schema';

export async function hasGrant(
  db: Db,
  guildId: string,
  roleIds: readonly string[],
  permission: string,
): Promise<boolean> {
  if (roleIds.length === 0) {
    return false;
  }

  const rows = await db
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, guildId),
        eq(rolePermissions.permission, permission),
        inArray(rolePermissions.roleId, [...roleIds]),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function grant(
  db: Db,
  input: {
    guildId: string;
    roleId: string;
    permission: string;
    grantedBy: string;
  },
): Promise<boolean> {
  const rows = await db
    .insert(rolePermissions)
    .values(input)
    .onConflictDoNothing()
    .returning({ roleId: rolePermissions.roleId });

  return rows.length > 0;
}

export async function revoke(
  db: Db,
  input: { guildId: string; roleId: string; permission: string },
): Promise<boolean> {
  const rows = await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, input.guildId),
        eq(rolePermissions.roleId, input.roleId),
        eq(rolePermissions.permission, input.permission),
      ),
    )
    .returning({ roleId: rolePermissions.roleId });

  return rows.length > 0;
}

export async function listGrants(
  db: Db,
  guildId: string,
  roleId?: string,
): Promise<Array<{ roleId: string; permission: string }>> {
  return db
    .select({
      roleId: rolePermissions.roleId,
      permission: rolePermissions.permission,
    })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, guildId),
        roleId === undefined ? undefined : eq(rolePermissions.roleId, roleId),
      ),
    )
    .orderBy(rolePermissions.roleId, rolePermissions.permission)
    .limit(500);
}
