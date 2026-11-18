import type {
  GrantRepository,
  GrantSubject,
} from '~/features/permissions/model';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../client';
import { rolePermissions } from './table';

export async function hasGrant(
  db: Db,
  guildId: string,
  roleIds: readonly string[],
  request: { permission: string; userId?: string },
): Promise<boolean> {
  const { permission, userId } = request;

  if (roleIds.length === 0 && userId === undefined) {
    return false;
  }

  const rows = await db
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, guildId),
        eq(rolePermissions.permission, permission),
        or(
          and(
            eq(rolePermissions.subjectType, 'role'),
            inArray(rolePermissions.roleId, [...roleIds]),
          ),
          userId === undefined
            ? undefined
            : and(
                eq(rolePermissions.subjectType, 'user'),
                eq(rolePermissions.roleId, userId),
              ),
        ),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function heldPermissions(
  db: Db,
  guildId: string,
  roleIds: readonly string[],
  userId?: string,
): Promise<string[]> {
  if (roleIds.length === 0 && userId === undefined) {
    return [];
  }

  const rows = await db
    .selectDistinct({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, guildId),
        or(
          and(
            eq(rolePermissions.subjectType, 'role'),
            inArray(rolePermissions.roleId, [...roleIds]),
          ),
          userId === undefined
            ? undefined
            : and(
                eq(rolePermissions.subjectType, 'user'),
                eq(rolePermissions.roleId, userId),
              ),
        ),
      ),
    );

  return rows.map((row) => row.permission);
}

export async function grant(
  db: Db,
  input: {
    guildId: string;
    roleId: string;
    subjectType?: GrantSubject;
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
  input: {
    guildId: string;
    roleId: string;
    permission: string;
    subjectType?: GrantSubject;
  },
): Promise<boolean> {
  const rows = await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, input.guildId),
        eq(rolePermissions.roleId, input.roleId),
        eq(rolePermissions.subjectType, input.subjectType ?? 'role'),
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
  subjectType?: GrantSubject,
): Promise<
  Array<{ roleId: string; permission: string; subjectType: GrantSubject }>
> {
  return await db
    .select({
      roleId: rolePermissions.roleId,
      subjectType: rolePermissions.subjectType,
      permission: rolePermissions.permission,
    })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.guildId, guildId),
        roleId === undefined ? undefined : eq(rolePermissions.roleId, roleId),
        subjectType === undefined
          ? undefined
          : eq(rolePermissions.subjectType, subjectType),
      ),
    )
    .orderBy(rolePermissions.roleId, rolePermissions.permission)
    .limit(500);
}

export function createGrantRepository(db: Db): GrantRepository {
  return {
    holds: (guildId, roleIds, permission, userId) =>
      hasGrant(db, guildId, roleIds, {
        permission,
        ...(userId !== undefined && { userId }),
      }),
    held: (guildId, roleIds, userId) =>
      heldPermissions(db, guildId, roleIds, userId),
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
                eq(rolePermissions.subjectType, input.subjectType ?? 'role'),
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
                subjectType: input.subjectType ?? 'role',
                grantedBy: input.grantedBy,
                permission,
              })),
            )
            .onConflictDoNothing();
        }
      }),
    list: (guildId, roleId, subjectType) =>
      listGrants(db, guildId, roleId, subjectType),
  };
}
