import type { GrantRepository } from '~/features/permissions/model';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client';
import { rolePermissions } from './table';

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

export async function heldPermissions(
  db: Db,
  guildId: string,
  roleIds: readonly string[],
): Promise<string[]> {
  if (roleIds.length === 0) {
    return [];
  }

  const rows = await db
    .selectDistinct({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, guildId),
        inArray(rolePermissions.roleId, [...roleIds]),
      ),
    );

  return rows.map((row) => row.permission);
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
  return await db
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

export function createGrantRepository(db: Db): GrantRepository {
  return {
    holds: (guildId, roleIds, permission) =>
      hasGrant(db, guildId, roleIds, permission),
    held: (guildId, roleIds) => heldPermissions(db, guildId, roleIds),
    grant: (change) => grant(db, change),
    revoke: (change) => revoke(db, change),
    apply: (input) =>
      db.transaction(async (tx) => {
        if (input.revoke.length > 0) {
          await tx
            .delete(rolePermissions)
            .where(
              and(
                eq(rolePermissions.guildId, input.guildId),
                eq(rolePermissions.roleId, input.roleId),
                inArray(rolePermissions.permission, [...input.revoke]),
              ),
            );
        }

        if (input.grant.length > 0) {
          await tx
            .insert(rolePermissions)
            .values(
              input.grant.map((permission) => ({
                guildId: input.guildId,
                roleId: input.roleId,
                grantedBy: input.grantedBy,
                permission,
              })),
            )
            .onConflictDoNothing();
        }
      }),
    list: (guildId, roleId) => listGrants(db, guildId, roleId),
  };
}
